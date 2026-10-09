terraform {
  required_version = ">= 1.10" # use_lockfile del backend S3

  # State remoto: sin esto vivia solo en la laptop que hizo el apply y un
  # runner de GitHub Actions arrancaba sin state (queria recrear todo, ver
  # progress.md 05/10). El bucket se creo a mano (huevo y gallina: no puede
  # vivir en el mismo state que guarda), privado, versionado y cifrado.
  # use_lockfile = lock nativo en S3, sin tabla DynamoDB.
  backend "s3" {
    bucket       = "micro-soar-tfstate-530390084140"
    key          = "micro-soar/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}
