#!/usr/bin/env bash
# Deploy Medusa on EC2: pull latest image, restart, prune old images.
# Usage (from ~/medusa on the server):
#   chmod +x deploy.sh && ./deploy.sh
set -euo pipefail

cd "$(dirname "$0")"

AWS_REGION="${AWS_REGION:-ap-south-1}"
ECR_REGISTRY="${ECR_REGISTRY:-409796440499.dkr.ecr.ap-south-1.amazonaws.com}"

echo "==> Logging in to ECR..."
aws ecr get-login-password --region "$AWS_REGION" | \
  docker login --username AWS --password-stdin "$ECR_REGISTRY"

echo "==> Pulling latest images..."
docker compose pull

echo "==> Starting services..."
docker compose up -d

echo "==> Removing unused images (keeps images used by running containers)..."
docker image prune -a -f

echo "==> Disk usage:"
docker system df
df -h /

echo "==> Service status:"
docker compose ps
