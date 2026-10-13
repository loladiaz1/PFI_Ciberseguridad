# ---------------------------------------------------------------------------
# Base para CI/CD: GitHub Actions se autentica contra AWS via OIDC (sin
# credenciales de larga duracion guardadas como secret) y opera con dos
# roles separados, segun el nivel de privilegio real que necesita cada uno:
#
#   - github_actions_ci:     "terraform plan" + lectura, en cada Pull Request.
#                             Nunca puede cambiar nada en AWS.
#   - github_actions_deploy: "terraform apply" + deploy del orchestrator,
#                             solo en push a main, y solo detras del gate
#                             manual del Environment "production" (ver
#                             .github/workflows/deploy.yml). El 26/08 un
#                             apply casi reemplazo las 3 instancias por un
#                             falso positivo (ver progress.md) -- el gate
#                             manual es la misma revision humana que evito
#                             el desastre esa vez, ahora como paso obligatorio
#                             en vez de depender de que alguien se acuerde.
#
# Falta, fuera de Terraform (ver README del workflow):
#   1) Configurar el Environment "production" en GitHub (Settings ->
#      Environments) con "Required reviewers" -- esto NO se puede hacer
#      desde Terraform/AWS, es un setting del lado de GitHub.
#   2) Correr `terraform apply` una vez a mano para crear estos roles
#      (no se aplica solo con este archivo en el repo).
# ---------------------------------------------------------------------------

variable "github_repo" {
  description = "owner/repo de GitHub, para restringir que SOLO los workflows de este repo puedan asumir los roles de CI/CD."
  type        = string
  default     = "loladiaz1/PFI_Ciberseguridad"
}

resource "aws_iam_openid_connect_provider" "github_actions" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
  # Thumbprint documentado por GitHub/AWS para este proveedor OIDC.
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

# ---------------------------------------------------------------------------
# Rol de solo-lectura para CI (corre en cada Pull Request, terraform plan).
# ---------------------------------------------------------------------------

resource "aws_iam_role" "github_actions_ci" {
  name = "micro-soar-github-actions-ci"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github_actions.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        }
        StringLike = {
          # Cualquier branch o PR de ESTE repo -- plan de solo lectura, sin
          # riesgo real aunque sea amplio.
          "token.actions.githubusercontent.com:sub" = "repo:${var.github_repo}:*"
        }
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "github_actions_ci_readonly" {
  role       = aws_iam_role.github_actions_ci.name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}

# ---------------------------------------------------------------------------
# Rol de deploy real (apply + SSM), SOLO para push a la rama main.
# ---------------------------------------------------------------------------

resource "aws_iam_role" "github_actions_deploy" {
  name = "micro-soar-github-actions-deploy"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github_actions.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          # Restringido a main -- ni siquiera un PR puede asumir este rol.
          # Ojo: si algun job usara "environment:", el sub del token pasa a
          # ...:environment:<nombre> y este rol lo rechaza (los workflows no
          # usan environments, ver deploy.yml).
          "token.actions.githubusercontent.com:sub" = "repo:${var.github_repo}:ref:refs/heads/main"
        }
      }
    }]
  })
}

# Permisos acotados a lo que este Terraform realmente administra (EC2, los
# propios roles de CI/CD, y SSM para el deploy del orchestrator) -- no
# AdministratorAccess. Si `terraform apply` falla por falta de un permiso
# puntual, agregarlo acá explícitamente en vez de ensanchar a un policy
# administrado amplio.
resource "aws_iam_role_policy" "github_actions_deploy" {
  name = "micro-soar-deploy-policy"
  role = aws_iam_role.github_actions_deploy.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "Ec2Manage"
        Effect = "Allow"
        Action = [
          "ec2:Describe*",
          "ec2:RunInstances",
          "ec2:TerminateInstances",
          "ec2:StopInstances",
          "ec2:StartInstances",
          "ec2:CreateTags",
          "ec2:DeleteTags",
          "ec2:*SecurityGroup*",
          "ec2:*KeyPair*",
          "ec2:ModifyInstanceAttribute",
        ]
        Resource = "*"
      },
      {
        Sid    = "IamForInstanceProfile"
        Effect = "Allow"
        Action = [
          "iam:GetRole",
          "iam:GetRolePolicy",
          "iam:GetInstanceProfile",
          "iam:PassRole",
        ]
        Resource = [
          aws_iam_role.orchestrator_ssm.arn,
        ]
      },
      {
        # terraform apply refresca TODOS los recursos del state, incluidos
        # los IAM de este archivo -- sin lectura de IAM falla con
        # AccessDenied antes de aplicar nada. Solo lectura: cambios de IAM
        # se siguen aplicando a mano desde la laptop.
        Sid    = "IamReadForRefresh"
        Effect = "Allow"
        Action = [
          "iam:Get*",
          "iam:List*",
        ]
        Resource = "*"
      },
      {
        Sid      = "TfStateBucket"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = "arn:aws:s3:::micro-soar-tfstate-530390084140"
      },
      {
        # Get/Put del state + Put/Delete del .tflock (use_lockfile).
        Sid      = "TfStateObjects"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = "arn:aws:s3:::micro-soar-tfstate-530390084140/micro-soar/*"
      },
      {
        Sid    = "SsmDeploy"
        Effect = "Allow"
        Action = [
          "ssm:SendCommand",
          "ssm:GetCommandInvocation",
          "ssm:ListCommandInvocations",
        ]
        Resource = "*"
      },
    ]
  })
}

# ---------------------------------------------------------------------------
# IAM role + instance profile para que el orchestrator reciba comandos de
# deploy via SSM Run Command -- sin necesitar el puerto 22 abierto a nadie,
# ni siquiera a los runners de GitHub (que tienen IPs dinamicas).
# ---------------------------------------------------------------------------

resource "aws_iam_role" "orchestrator_ssm" {
  name = "micro-soar-orchestrator-ssm-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "orchestrator_ssm" {
  role       = aws_iam_role.orchestrator_ssm.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "orchestrator_ssm" {
  name = "micro-soar-orchestrator-ssm-profile"
  role = aws_iam_role.orchestrator_ssm.name
}

output "github_actions_ci_role_arn" {
  description = "ARN a pegar en el workflow de CI (permissions: id-token: write)."
  value       = aws_iam_role.github_actions_ci.arn
}

output "github_actions_deploy_role_arn" {
  description = "ARN a pegar en el workflow de deploy."
  value       = aws_iam_role.github_actions_deploy.arn
}
