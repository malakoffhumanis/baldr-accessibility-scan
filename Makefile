# Image+registre par défaut ci-dessous — surcharger à l'appel : make docker IMAGE=<registre>/baldr TAG=1.0.4
IMAGE     ?= registry-anteprod.sharedsvc.kube.si2m.tec/test-store/baldr
TAG       ?= latest
PORT      ?= 3000
PLATFORMS ?= linux/amd64,linux/arm64
# URL du dépôt source (label OCI image.source) — ex: https://github.com/<org>/baldr
SOURCE    ?=

.PHONY: build docker buildx push release

# Produit dist/ + node_modules de production.
# À lancer sur LINUX (CI ubuntu ou conteneur linux) pour un node_modules compatible node:24-slim.
build:
	npm ci
	npm run build
	npm prune --omit=dev

# Construit l'image à partir des artefacts déjà présents (aucun build/install dans le Dockerfile).
docker:
	docker build \
	  --build-arg VERSION=$(TAG) \
	  --build-arg BUILD_DATE=$(shell date -u +%Y-%m-%dT%H:%M:%SZ) \
	  --build-arg VCS_REF=$(shell git rev-parse --short HEAD) \
	  --build-arg PORT=$(PORT) \
	  --build-arg SOURCE=$(SOURCE) \
	  -t $(IMAGE):$(TAG) .

push:
	docker push $(IMAGE):$(TAG)

# Build multi-arch + push avec attestations (provenance + SBOM).
# Nécessite buildx + un builder actif (docker buildx create --use) et un registre.
buildx:
	docker buildx build \
	  --platform $(PLATFORMS) \
	  --provenance=true --sbom=true \
	  --build-arg VERSION=$(TAG) \
	  --build-arg BUILD_DATE=$(shell date -u +%Y-%m-%dT%H:%M:%SZ) \
	  --build-arg VCS_REF=$(shell git rev-parse --short HEAD) \
	  --build-arg PORT=$(PORT) \
	  --build-arg SOURCE=$(SOURCE) \
	  -t $(IMAGE):$(TAG) \
	  --push .

release: build docker push
