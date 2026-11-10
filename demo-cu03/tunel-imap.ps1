# Tunel SSM al IMAPS del mail server, para Thunderbird: 127.0.0.1:10993. No se
# usa 993 local: Thunderbird baja el certificado por https y ese puerto esta
# bloqueado para https, asi que no se puede cargar la excepcion.
# Dejar esta ventana abierta durante la demo. Clave de alice y bob:
#   terraform -chdir=terraform output -raw mail_demo_password
. "$PSScriptRoot\_ssm.ps1"

aws ssm start-session --target (Get-MailInstance) --document-name AWS-StartPortForwardingSession --parameters "portNumber=993,localPortNumber=10993"
