FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY src ./src
COPY public ./public
USER node
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "src/main.mjs"]
