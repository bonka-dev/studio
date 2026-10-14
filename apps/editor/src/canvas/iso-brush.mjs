export function snapBrushCell(point, layer, scene) {
    const cell = {
        x: Math.round((point.x - layer.hOffset - scene.tileWidth / 2) / scene.gridWidth),
        y: Math.round((point.y + layer.zOffset - scene.tileHeight / 2) / scene.gridHeight),
    };
    if(cell.x < 0 || cell.y < 0 || cell.x >= scene.width || cell.y >= scene.height) return null;
    return cell;
}

export function nearestIsoBrushCell(point, anchor, layer, scene, spacing) {
    const pointerX = (point.x - layer.hOffset - scene.tileWidth / 2) / scene.gridWidth;
    const pointerY = (point.y + layer.zOffset - scene.tileHeight / 2) / scene.gridHeight;
    const deltaX = pointerX - anchor.x;
    const deltaY = pointerY - anchor.y;
    const pointerU = (deltaX + deltaY) / 2;
    const pointerV = (deltaX - deltaY) / 2;
    let nearest = null;
    let nearestDistance = Infinity;

    for(let uIndex = Math.floor(pointerU / spacing) - 1; uIndex <= Math.floor(pointerU / spacing) + 2; ++uIndex) {
        for(let vIndex = Math.floor(pointerV / spacing) - 1; vIndex <= Math.floor(pointerV / spacing) + 2; ++vIndex) {
            const u = uIndex * spacing;
            const v = vIndex * spacing;
            const cell = { x: anchor.x + u + v, y: anchor.y + u - v };
            if(cell.x < 0 || cell.y < 0 || cell.x >= scene.width || cell.y >= scene.height) continue;
            const distance = Math.hypot(
                (cell.x - pointerX) * scene.gridWidth,
                (cell.y - pointerY) * scene.gridHeight
            );
            if(distance < nearestDistance) {
                nearest = cell;
                nearestDistance = distance;
            }
        }
    }
    return nearest;
}

export function interpolateIsoBrushCells(last, target, anchor, spacing) {
    let u = ((last.x - anchor.x) + (last.y - anchor.y)) / (2 * spacing);
    let v = ((last.x - anchor.x) - (last.y - anchor.y)) / (2 * spacing);
    const targetU = ((target.x - anchor.x) + (target.y - anchor.y)) / (2 * spacing);
    const targetV = ((target.x - anchor.x) - (target.y - anchor.y)) / (2 * spacing);
    const stepU = u < targetU ? 1 : -1;
    const stepV = v < targetV ? 1 : -1;
    const deltaU = Math.abs(targetU - u);
    const deltaV = Math.abs(targetV - v);
    let error = deltaU - deltaV;
    const cells = [];

    while(u !== targetU || v !== targetV) {
        const doubleError = error * 2;
        if(doubleError > -deltaV) {
            error -= deltaV;
            u += stepU;
        }
        if(doubleError < deltaU) {
            error += deltaU;
            v += stepV;
        }
        cells.push({
            x: anchor.x + (u + v) * spacing,
            y: anchor.y + (u - v) * spacing,
        });
    }
    return cells;
}
