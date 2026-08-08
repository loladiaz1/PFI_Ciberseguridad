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

variable "public_key_path" {
  description = "Path to the SSH public key that becomes the EC2 key pair. Generate one with: ssh-keygen -t ed25519"
  type        = string
  default     = "~/.ssh/id_ed25519.pub"
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
