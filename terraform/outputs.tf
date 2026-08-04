output "wazuh_public_ip" {
  description = "Public IP of the Wazuh instance."
  value       = aws_instance.wazuh.public_ip
}

output "wazuh_instance_id" {
  description = "EC2 instance ID. Stop it when you're done for the day: aws ec2 stop-instances --instance-ids <id>"
  value       = aws_instance.wazuh.id
}

output "ssh_command" {
  description = "Ready-to-use SSH command."
  value       = "ssh -i ${replace(pathexpand(var.public_key_path), ".pub", "")} ubuntu@${aws_instance.wazuh.public_ip}"
}

output "wazuh_api_endpoint" {
  description = "Wazuh API base URL (available once Wazuh is installed)."
  value       = "https://${aws_instance.wazuh.public_ip}:55000"
}

output "victim_public_ip" {
  description = "Public IP of the victim instance (brute-force target)."
  value       = aws_instance.victim.public_ip
}

output "victim_ssh_command" {
  description = "Ready-to-use SSH command for the victim instance."
  value       = "ssh -i ${replace(pathexpand(var.public_key_path), ".pub", "")} ubuntu@${aws_instance.victim.public_ip}"
}
