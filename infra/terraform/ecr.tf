# One repo per service + one per tool image. Path is
# <account>.dkr.ecr.<region>.amazonaws.com/eventide/<name>. The lab's
# LabEksNodeRole already carries AmazonEC2ContainerRegistryReadOnly, so nodes
# can pull without any extra policy here.

resource "aws_ecr_repository" "service" {
  for_each = toset(concat(var.services, var.tool_images))

  name                 = "${var.project}/${each.key}"
  image_tag_mutability = "MUTABLE" # deploy.sh overwrites :latest during dev iteration

  image_scanning_configuration {
    scan_on_push = true
  }

  # the permanent layer is never destroyed; make repo deletion explicit if it ever is.
  force_delete = false
}

# Keep the registry small — untagged layers pile up fast with a per-session
# rebuild loop, and ECR storage counts against the $50 cap.
resource "aws_ecr_lifecycle_policy" "service" {
  for_each   = aws_ecr_repository.service
  repository = each.value.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expire untagged images after 3 days"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 3
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Keep only the 10 most recent tagged images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 10
        }
        action = { type = "expire" }
      },
    ]
  })
}

# Mirrors of the two public images Terraform's Helm releases install. The edge tier has
# no route to the internet, so it can't pull from registry.k8s.io; scripts/mirror-images.sh
# copies them here once (permanent repos, so once ever per tag). A pull-through cache is
# not an option: its first pull needs ecr:CreateRepository on the node role, which the lab
# won't let us grant.
resource "aws_ecr_repository" "mirror" {
  for_each = toset(["k8s/ingress-nginx-controller", "k8s/metrics-server"])

  name                 = each.key
  image_tag_mutability = "MUTABLE"
  force_delete         = false
}
