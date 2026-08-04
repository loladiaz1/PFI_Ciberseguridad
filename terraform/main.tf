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
