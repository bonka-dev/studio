FROM devkitpro/devkitarm:latest

RUN apt-get update && apt-get install -y \
    git \
    make \
    nodejs \
    npm \
    python3 \
    python3-pip \
    libpng-dev \
    unzip \
    xz-utils \
    && rm -rf /var/lib/apt/lists/*

# Install Bonka's Node dependencies outside /workspace, because the workspace
# is bind-mounted when the development container starts.
COPY devtools/bonka/package.json devtools/bonka/package-lock.json /opt/bonka/
RUN npm ci --omit=dev --prefix /opt/bonka \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_PATH=/opt/bonka/node_modules
ENV DEVKITPRO=/opt/devkitpro
ENV DEVKITARM=/opt/devkitpro/devkitARM

WORKDIR /workspace

CMD ["/bin/bash"]
