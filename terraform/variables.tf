variable "aws_region" {
  description = "AWS region to deploy into. us-east-1 is cheapest; sa-east-1 (São Paulo) is lowest latency from Argentina."
  type        = string
  default     = "us-east-1"
}

variable "my_ip" {
  description = "Your public IP in CIDR form, e.g. 200.1.2.3/32. SSH (22) and the Wazuh API (55000) are ONLY reachable from here. Find it with: curl -s https://checkip.amazonaws.com"
  type        = string

  validation {
    condition     = can(cidrhost(var.my_ip, 0))
    error_message = "my_ip must be a CIDR block, e.g. 200.1.2.3/32 (append /32 for a single IP)."
  }
}

variable "extra_ssh_cidrs" {
  description = "Rangos extra (ademas de my_ip) que pueden entrar por SSH (22) a las 3 instancias, ej. [\"181.10.20.0/24\"]. No abre la API de Wazuh (55000), que sigue solo para my_ip."
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for c in var.extra_ssh_cidrs : can(cidrhost(c, 0))])
    error_message = "Cada elemento de extra_ssh_cidrs tiene que ser un CIDR, ej. 181.10.20.0/24."
  }
}

variable "public_key_path" {
  description = "Path to the SSH public key that becomes the EC2 key pair. Generate one with: ssh-keygen -t ed25519"
  type        = string
  default     = "~/.ssh/id_ed25519.pub"
}

variable "ubuntu_ami_id" {
  description = "AMI ID fijo para las 3 instancias (ej. ami-0abcd1234...). Vacio = resuelve 'most_recent' en cada apply (riesgo: una AMI nueva de Canonical entre dos applies fuerza reemplazo de las 3 instancias sin que nadie haya tocado el repo). Recomendado: fijarlo al AMI que las instancias ya estan corriendo -- ver el AMI ID actual en la consola EC2 (Instance -> Details -> AMI ID)."
  type        = string
  default     = ""
}

variable "instance_type" {
  description = "EC2 instance type for Wazuh. m7i-flex.large (2 vCPU, 8 GB) gives the all-in-one install (manager + indexer + dashboard) real headroom; t3.medium (4 GB) is the tight floor if cost pressure forces a downgrade."
  type        = string
  default     = "m7i-flex.large"
}

variable "root_volume_gb" {
  description = "Root EBS (gp3) volume size in GB."
  type        = number
  default     = 30
}

variable "install_wazuh" {
  description = "true  -> user_data runs the Wazuh all-in-one installer on first boot. false -> bare Ubuntu, you install Wazuh by hand."
  type        = bool
  default     = true
}

variable "victim_instance_type" {
  description = "EC2 instance type for the brute-force victim. Just needs to run sshd + a Wazuh agent, so the cheapest general-purpose size is enough."
  type        = string
  default     = "t3.micro"
}

variable "victim_root_volume_gb" {
  description = "Root EBS (gp3) volume size in GB for the victim instance."
  type        = number
  default     = 8
}

variable "wazuh_agent_version" {
  description = "Wazuh agent package version to install on the victim (must match the manager's installed version exactly, or enrollment is rejected with 'Incompatible version'). Check the manager's version with: sudo /var/ossec/bin/wazuh-control info"
  type        = string
  default     = "4.8.2"
}

variable "orchestrator_instance_type" {
  description = "EC2 instance type for the orchestrator (Node/Express + Prisma). PLAN.md sugiere t3.small."
  type        = string
  default     = "t3.small"
}

variable "orchestrator_root_volume_gb" {
  description = "Root EBS (gp3) volume size in GB for the orchestrator instance."
  type        = number
  default     = 20
}

variable "tailscale_authkey" {
  description = "Auth key reusable de Tailscale (Settings -> Keys en el admin console) para que el orchestrator se una a la tailnet solo, sin 'tailscale up' manual. Vacio = queda pendiente por SSH."
  type        = string
  default     = ""
  sensitive   = true
}

variable "mail_instance_type" {
  description = "EC2 instance type del mail server de laboratorio (CU-03). Postfix + Dovecot + agente Wazuh entran en 1 GB; Rspamd (futuro) tambien, sin ClamAV."
  type        = string
  default     = "t3.micro"
}

variable "mail_domain" {
  description = "Dominio ficticio del laboratorio de correo (CU-03). No resuelve en internet: el correo solo circula dentro del mail server."
  type        = string
  default     = "lab.micro-soar.internal"
}
