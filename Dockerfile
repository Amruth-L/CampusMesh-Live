FROM node:22-bookworm-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci --include=dev
COPY frontend/ ./
ENV VITE_API_URL=/ VITE_API_BASE_URL=/
RUN npm run build

FROM node:22-bookworm-slim AS server
WORKDIR /app
ENV NODE_ENV=production SERVE_FRONTEND=true CALLS_MODE=preview CALLS_SCHEDULER_ENABLED=false
COPY backend/package*.json ./backend/
RUN npm ci --prefix backend --omit=dev && npm cache clean --force
COPY backend/src ./backend/src
COPY --from=frontend /app/frontend/dist ./frontend/dist
COPY package.json ./
USER node
EXPOSE 3003
CMD ["npm", "start"]
