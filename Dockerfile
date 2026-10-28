FROM devkitpro/devkitarm:latest

ARG BUTANO_VERSION=21.2.0

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

# Butano belongs to the container so a Bonka checkout needs no vendor directory.
RUN git clone --branch "${BUTANO_VERSION}" --depth 1 \
    https://github.com/GValiente/butano.git /opt/butano

ENV DEVKITPRO=/opt/devkitpro
ENV DEVKITARM=/opt/devkitpro/devkitARM

WORKDIR /workspace

CMD ["/bin/bash"]
