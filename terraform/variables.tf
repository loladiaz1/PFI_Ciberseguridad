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
  description = "EC2 instance type for Wazuh. t3.medium (4 GB) is the practical floor for the all-in-one install; it will be tight."
  type        = string
  default     = "t3.medium"
}

variable "root_volume_gb" {
  description = "Root EBS (gp3) volume size in GB."
  type        = number
  default     = 30
}

variable "install_wazuh" {
  description = "true  -> user_data runs the Wazuh all-in-one installer on first boot. false -> bare Ubuntu, you install Wazuh by hand (recommended for the spike so you see the API/token flow yourself)."
  type        = bool
  default     = false
}
