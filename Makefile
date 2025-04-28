REGION=us-central1
PROJECT_ID=mckradle-3c267
DOCKER_URL=${REGION}-docker.pkg.dev/${PROJECT_ID}/${env}-minecraft/web-proxy
DOCKER_CLIENT_URL=${REGION}-docker.pkg.dev/${PROJECT_ID}/${env}-minecraft/web-viewer-client
PROXY_IMAGE_TAG=${DOCKER_URL}:latest
CLIENT_IMAGE_TAG=${DOCKER_CLIENT_URL}:e1f5177
SERVICE_NAME=web-proxy

ifndef env
	override env = dev
endif

docker/login:
	gcloud auth configure-docker ${REGION}-docker.pkg.dev

docker/build: docker/build-proxy docker/build-client

docker/build-proxy:
	docker buildx build --platform linux/amd64 . -f Dockerfile.proxy --load -t ${PROXY_IMAGE_TAG}

docker/build-client:
	docker buildx build --platform linux/amd64 . -f Dockerfile --load -t ${CLIENT_IMAGE_TAG}

docker/push-client:
	docker push ${CLIENT_IMAGE_TAG}

docker/push:
	docker push ${PROXY_IMAGE_TAG}

deploy:
	gcloud run deploy ${SERVICE_NAME} --image ${PROXY_IMAGE_TAG} --region ${REGION}
