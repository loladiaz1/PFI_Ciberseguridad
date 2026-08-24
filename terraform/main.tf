# ---------------------------------------------------------------------------
# Lookups
# ---------------------------------------------------------------------------

# Latest Ubuntu 22.04 LTS (Jammy) AMI, published by Canonical. Region-agnostic.
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# Use the account's default VPC and one of its subnets. Enough for the spike;
# a dedicated VPC comes in a later phase.
data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

# ---------------------------------------------------------------------------
# SSH key
# ---------------------------------------------------------------------------

resource "aws_key_pair" "wazuh" {
  key_name   = "micro-soar-wazuh"
  public_key = file(pathexpand(var.public_key_path))
}

# ---------------------------------------------------------------------------
# Security group  (Spike 0: only SSH + Wazuh API, only from your IP)
# ---------------------------------------------------------------------------

resource "aws_security_group" "wazuh" {
  name        = "micro-soar-wazuh-sg"
  description = "Spike 0: SSH (22) and Wazuh API (55000) from a single IP"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "SSH from my IP"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.my_ip]
  }

  ingress {
    description = "Wazuh API from my IP"
    from_port   = 55000
    to_port     = 55000
    protocol    = "tcp"
    cidr_blocks = [var.my_ip]
  }

  # Agents connect outbound to the manager on 1514 (events) and 1515
  # (enrollment). Only the victim instance needs to reach the manager this way.
  ingress {
    description     = "Wazuh agent enrollment/events from the victim instance"
    from_port       = 1514
    to_port         = 1515
    protocol        = "tcp"
    security_groups = [aws_security_group.victim.id]
  }

  # El orchestrator llama a la API de Wazuh (POST /active-response) para
  # ejecutar el bloqueo. Por VPC interna, no por var.my_ip.
  ingress {
    description     = "Wazuh API from the orchestrator instance"
    from_port       = 55000
    to_port         = 55000
    protocol        = "tcp"
    security_groups = [aws_security_group.orchestrator.id]
  }

  egress {
    description = "All outbound (package installs, updates, threat-intel APIs)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "micro-soar-wazuh-sg"
  }
}

# ---------------------------------------------------------------------------
# Wazuh instance
# ---------------------------------------------------------------------------

resource "aws_instance" "wazuh" {
  ami                         = data.aws_ami.ubuntu.id
  instance_type               = var.instance_type
  subnet_id                   = data.aws_subnets.default.ids[0]
  key_name                    = aws_key_pair.wazuh.key_name
  vpc_security_group_ids      = [aws_security_group.wazuh.id]
  associate_public_ip_address = true # no Elastic IP (per plan); auto-assigned public IP

  root_block_device {
    volume_size = var.root_volume_gb
    volume_type = "gp3"
  }

  # Only runs the installer when install_wazuh = true; otherwise a bare instance.
  user_data = var.install_wazuh ? file("${path.module}/user_data_wazuh.sh") : null

  tags = {
    Name = "micro-soar-wazuh"
    Role = "wazuh-xdr"
  }
}

# ---------------------------------------------------------------------------
# Victim instance (brute-force SSH target, runs a Wazuh agent)
# ---------------------------------------------------------------------------

resource "aws_security_group" "victim" {
  name        = "micro-soar-victim-sg"
  description = "Spike 0: SSH (22) from my IP (the attacker laptop)"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "SSH from my IP (attacker laptop, brute-forced in the demo)"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.my_ip]
  }

  egress {
    description = "All outbound (package installs, agent to manager enrollment)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "micro-soar-victim-sg"
  }
}

resource "aws_instance" "victim" {
  ami                         = data.aws_ami.ubuntu.id
  instance_type               = var.victim_instance_type
  subnet_id                   = data.aws_subnets.default.ids[0]
  key_name                    = aws_key_pair.wazuh.key_name
  vpc_security_group_ids      = [aws_security_group.victim.id]
  associate_public_ip_address = true

  root_block_device {
    volume_size = var.victim_root_volume_gb
    volume_type = "gp3"
  }

  # Installs the Wazuh agent and enrolls it against the manager's private IP
  # (same VPC, no need to go through the public internet).
  user_data = <<-EOT
    #!/bin/bash
    set -euxo pipefail
    echo 'ubuntu ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/99-ubuntu-nopasswd
    chmod 440 /etc/sudoers.d/99-ubuntu-nopasswd
    curl -s https://packages.wazuh.com/key/GPG-KEY-WAZUH | gpg --no-default-keyring --keyring gnupg-ring:/usr/share/keyrings/wazuh.gpg --import
    chmod 644 /usr/share/keyrings/wazuh.gpg
    echo "deb [signed-by=/usr/share/keyrings/wazuh.gpg] https://packages.wazuh.com/4.x/apt/ stable main" | tee -a /etc/apt/sources.list.d/wazuh.list
    apt-get update
    WAZUH_MANAGER='${aws_instance.wazuh.private_ip}' apt-get install -y wazuh-agent=${var.wazuh_agent_version}-1
    systemctl daemon-reload
    systemctl enable wazuh-agent
    systemctl start wazuh-agent
  EOT

  tags = {
    Name = "micro-soar-victim"
    Role = "brute-force-target"
  }
}

# ---------------------------------------------------------------------------
# Orchestrator instance (Node/Express + Prisma). Reachable from el celular
# solo por Tailscale (100.x.y.z) -- el puerto de la app NUNCA se abre al
# 0.0.0.0/0 ni siquiera a var.my_ip. Ese es el pitch de Zero Trust del PLAN.
# ---------------------------------------------------------------------------

resource "aws_security_group" "orchestrator" {
  name        = "micro-soar-orchestrator-sg"
  description = "SSH (22) from my IP only. La app se sirve por Tailscale, no por este SG."
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "SSH from my IP"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.my_ip]
  }

  egress {
    description = "All outbound (npm install, Tailscale coordination/DERP, Wazuh API)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "micro-soar-orchestrator-sg"
  }
}

resource "aws_instance" "orchestrator" {
  ami                         = data.aws_ami.ubuntu.id
  instance_type               = var.orchestrator_instance_type
  subnet_id                   = data.aws_subnets.default.ids[0]
  key_name                    = aws_key_pair.wazuh.key_name
  vpc_security_group_ids      = [aws_security_group.orchestrator.id]
  associate_public_ip_address = true # solo para el SSH inicial; el trafico de la app va por Tailscale

  root_block_device {
    volume_size = var.orchestrator_root_volume_gb
    volume_type = "gp3"
  }

  # Instala Node.js, Tailscale y pm2. El deploy del codigo (rsync + npm ci +
  # prisma db push + pm2 start) queda manual -- ver el output orchestrator_deploy_hint.
  user_data = <<-EOT
    #!/bin/bash
    set -euxo pipefail
    echo 'ubuntu ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/99-ubuntu-nopasswd
    chmod 440 /etc/sudoers.d/99-ubuntu-nopasswd

    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs git
    npm install -g pm2

    curl -fsSL https://tailscale.com/install.sh | sh

    TAILSCALE_AUTHKEY="${var.tailscale_authkey}"
    if [ -n "$TAILSCALE_AUTHKEY" ]; then
      tailscale up --authkey="$TAILSCALE_AUTHKEY" --hostname=micro-soar-orchestrator
    else
      echo "tailscale_authkey no seteado -- correr 'sudo tailscale up' a mano por SSH." | tee /home/ubuntu/TAILSCALE_PENDING.txt
    fi
  EOT

  tags = {
    Name = "micro-soar-orchestrator"
    Role = "orchestrator"
  }
}
