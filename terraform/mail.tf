# ---------------------------------------------------------------------------
# Mail server de laboratorio (CU-03: phishing reportado por el usuario).
#
# Postfix (entrega local, solo loopback: el puerto 25 no se abre a nadie) +
# Dovecot (IMAPS 993, solo desde el SG del orchestrator) + agente Wazuh.
# Dominio ficticio lab.micro-soar.internal, buzones alice / bob / phishing.
# El orchestrator entra con un usuario master de Dovecot ("alice*soar"),
# restringido a su IP privada (allow_nets): es el equivalente de laboratorio
# del permiso Mail.ReadWrite de Microsoft Graph. Toda la integracion vive en
# orchestrator/src/mailProvider.js, el unico archivo que cambia al migrar a
# Microsoft 365 o Google Workspace.
#
# Instancia aparte y no la victima: el servidor de correo es otro activo
# (otro agente, otra criticidad), y es donde corre Rspamd en el futuro.
# ---------------------------------------------------------------------------

resource "random_password" "mail_master" {
  length  = 32
  special = false
}

# Una sola clave para los buzones de prueba (alice, bob, phishing): solo se
# usa para mirarlos desde un cliente de correo en la demo.
resource "random_password" "mail_demo" {
  length  = 20
  special = false
}

resource "aws_security_group" "mail" {
  name        = "micro-soar-mail-sg"
  description = "Mail lab: SSH from my IP, IMAPS only from the orchestrator"
  vpc_id      = data.aws_vpc.default.id

  # Reglas inline, no aws_security_group_rule sueltas (ver progress.md
  # 04/08: mezclar los dos estilos hacia desaparecer reglas).
  ingress {
    description = "SSH from my IP"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = concat([var.my_ip], var.extra_ssh_cidrs)
  }

  ingress {
    description     = "IMAPS from the orchestrator (report mailbox polling + quarantine)"
    from_port       = 993
    to_port         = 993
    protocol        = "tcp"
    security_groups = [aws_security_group.orchestrator.id]
  }

  egress {
    description = "All outbound (package installs, agent to manager enrollment)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "micro-soar-mail-sg"
  }
}

resource "aws_instance" "mail" {
  ami                         = local.ubuntu_ami_id
  instance_type               = var.mail_instance_type
  subnet_id                   = data.aws_subnets.default.ids[0]
  key_name                    = aws_key_pair.wazuh.key_name
  vpc_security_group_ids      = [aws_security_group.mail.id]
  iam_instance_profile        = aws_iam_instance_profile.orchestrator_ssm.name # SSM: correr send-phish sin SSH
  associate_public_ip_address = true

  root_block_device {
    volume_size = 8
    volume_type = "gp3"
  }

  # Ojo: cambiar este script (o las claves) reemplaza la instancia, y el
  # deploy automatico frena ante cualquier replace -- se aplica a mano.
  user_data = templatefile("${path.module}/user_data_mail.sh", {
    wazuh_manager_ip     = aws_instance.wazuh.private_ip
    wazuh_agent_version  = var.wazuh_agent_version
    orchestrator_ip      = aws_instance.orchestrator.private_ip
    mail_domain          = var.mail_domain
    mail_master_password = random_password.mail_master.result
    mail_demo_password   = random_password.mail_demo.result
  })

  # Ver comentario equivalente en aws_instance.wazuh.
  lifecycle {
    ignore_changes = [associate_public_ip_address]
  }

  tags = {
    Name = "micro-soar-mail"
    Role = "mail-server"
  }
}

output "mail_private_ip" {
  description = "IP privada del mail server: MAIL_IMAP_HOST en el .env del orchestrator."
  value       = aws_instance.mail.private_ip
}

output "mail_instance_id" {
  description = "Para correr la demo por SSM: aws ssm send-command --instance-ids <id> --document-name AWS-RunShellScript --parameters commands=send-phish"
  value       = aws_instance.mail.id
}

output "mail_master_password" {
  description = "MAIL_MASTER_PASSWORD del .env del orchestrator (terraform output -raw mail_master_password)."
  value       = random_password.mail_master.result
  sensitive   = true
}

output "mail_demo_password" {
  description = "Clave de los buzones de prueba (alice, bob, phishing)."
  value       = random_password.mail_demo.result
  sensitive   = true
}
