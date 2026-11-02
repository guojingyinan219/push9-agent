FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY bin ./bin
COPY src ./src
COPY skills ./skills
USER node
ENV NODE_ENV=production PUSH9_MCP_TRANSPORT=http PUSH9_MCP_HOST=0.0.0.0 PUSH9_MCP_PORT=3110
EXPOSE 3110
CMD ["node", "bin/push9-agent.mjs", "mcp"]
