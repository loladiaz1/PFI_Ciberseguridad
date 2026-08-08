provider "aws" {
  region = var.aws_region

  # Every resource gets these tags automatically (easy to find / clean up later).
  default_tags {
    tags = {
      Project   = "micro-soar"
      Phase     = "spike-0"
      ManagedBy = "terraform"
    }
  }
}
