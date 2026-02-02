DEV_DB_URI=postgresql://postgres:postgres@0.0.0.0:5434/codescreen_1?schema=public

# Build development Docker images
dev:
	make clean
	docker build -f server/Dockerfile.dev -t code-screen-server:dev ./server
	docker build -f web/Dockerfile.dev -t code-screen-web:dev ./web

# Start all services
up:
	docker compose up --remove-orphans

# Start all services in detached mode
up-d:
	docker compose up -d --remove-orphans

# Stop all services
down:
	docker compose down

# Remove containers and prune images
prune:
	docker container prune
	docker image prune

# Execute shell in server container
exec-server:
	docker exec -it code_screen_1_server sh

# Execute shell in web container
exec-web:
	docker exec -it code_screen_1_web sh

# Run database migrations
migrate:
	cd server && db__uri=$(DEV_DB_URI) yarn prisma migrate dev

# Generate Prisma client
generate:
	cd server && yarn prisma generate

# Create a new migration
generate_migration:
	cd server && db__uri=$(DEV_DB_URI) yarn prisma migrate dev --name $(name)

# Run Prisma Studio
studio:
	cd server && db__uri=$(DEV_DB_URI) yarn prisma studio --port 3101 --browser none

# Run server tests
test-server:
	cd server && STAGE=test yarn test:unit

# Install dependencies
install:
	cd server && yarn install
	cd web && yarn install

# Clean build artifacts and node_modules
clean:
	-rm -rf server/node_modules
	-rm -rf server/build
	-rm -rf web/node_modules
	-rm -rf web/dist
	-docker container rm code_screen_1_server
	-docker container rm code_screen_1_web
	-docker volume rm cs1_server_node_modules
	-docker volume rm cs1_web_node_modules

# Local development (without Docker)
local-server:
	cd server && yarn up

local-web:
	cd web && yarn web:dev

.PHONY: dev up up-d down prune exec-server exec-web migrate generate generate_migration studio test-server install clean local-server local-web
