FROM node:22-bookworm-slim
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app
COPY package*.json ./
RUN npm ci && npx playwright install --with-deps chromium && chmod -R a+rX /ms-playwright
COPY . .
RUN npm run build && mkdir -p /app/.data && chown -R node:node /app
ENV NODE_ENV=production PORT=3001
USER node
EXPOSE 3001
CMD ["npm", "start"]
