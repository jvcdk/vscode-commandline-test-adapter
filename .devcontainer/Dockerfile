ARG VARIANT="20-bookworm"
FROM mcr.microsoft.com/devcontainers/typescript-node:${VARIANT}

USER node
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/home/node/.bun/bin:${PATH}"

RUN curl -fsSL https://claude.ai/install.sh | bash

USER root
