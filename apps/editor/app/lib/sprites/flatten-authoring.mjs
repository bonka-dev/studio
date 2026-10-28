export async function flattenSpriteAuthoring(authoring) {
    const canvas = document.createElement("canvas");
    canvas.width = authoring.width;
    canvas.height = authoring.height;
    const context = canvas.getContext("2d");

    for(const layer of authoring.layers) {
        if(layer.kind !== "drawing" || !layer.visible) continue;
        const width = layer.width ?? authoring.width;
        const offset = layer.offset ?? { x: 0, y: 0 };
        for(let index = 0; index < layer.pixels.length; ++index) {
            const color = layer.pixels[index];
            if(!color) continue;
            context.fillStyle = color;
            context.fillRect(index % width + offset.x, Math.floor(index / width) + offset.y, 1, 1);
        }
    }

    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
    if(!blob) throw new Error("Could not flatten sprite authoring to PNG.");
    return new Uint8Array(await blob.arrayBuffer());
}
