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

output "orchestrator_public_ip" {
  description = "Public IP of the orchestrator instance (solo para el SSH inicial)."
  value       = aws_instance.orchestrator.public_ip
}

output "orchestrator_ssh_command" {
  description = "Ready-to-use SSH command for the orchestrator instance."
  value       = "ssh -i ${replace(pathexpand(var.public_key_path), ".pub", "")} ubuntu@${aws_instance.orchestrator.public_ip}"
}

output "orchestrator_deploy_hint" {
  description = "Pasos para llevar el codigo del orchestrator a la instancia y levantarlo."
  value       = <<-EOT
    1) rsync -av --exclude node_modules --exclude .env orchestrator/ ubuntu@${aws_instance.orchestrator.public_ip}:~/orchestrator/
    2) scp orchestrator/.env ubuntu@${aws_instance.orchestrator.public_ip}:~/orchestrator/.env   # editar WAZUH_HOST a la IP PRIVADA de wazuh antes
    3) ssh ubuntu@${aws_instance.orchestrator.public_ip} 'cd orchestrator && npm ci && npx prisma db push && pm2 start src/app.js --name orchestrator && pm2 save'
    4) Si tailscale_authkey quedo vacio: ssh y correr 'sudo tailscale up' a mano (cat ~/TAILSCALE_PENDING.txt confirma si quedo pendiente).
    5) En AppMicroSOAR/.env poner EXPO_PUBLIC_API_URL=http://<ip-100.x.y.z-de-tailscale>:8000
  EOT
}
