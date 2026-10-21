export function traverseLayers(layers) {
    const result = [];

    for(const layer of layers) {
        result.push(layer);
        if(layer.type === "group") {
            result.push(...traverseLayers(layer.layers));
        }
    }

    return result;
}

export function findLayer(layers, id) {
    return traverseLayers(layers).find(layer => layer.id === id);
}

export function findLayerPath(layers, id) {
    for(let index = 0; index < layers.length; index++) {
        const layer = layers[index];
        if(layer.id === id) return [index];
        if(layer.type === "group") {
            const childPath = findLayerPath(layer.layers, id);
            if(childPath) return [index, ...childPath];
        }
    }

    return undefined;
}

export function getLayerParent(layers, id) {
    const path = findLayerPath(layers, id);
    if(! path) return undefined;
    if(path.length === 1) return null;

    let parent = layers[path[0]];
    for(const index of path.slice(1, -1)) {
        parent = parent.layers[index];
    }
    return parent;
}

function normalizeOrder(layers) {
    return layers.map((layer, order) => layer.order === order ? layer : { ...layer, order });
}

function allocateLayer(state) {
    const usedIds = new Set(traverseLayers(state.layers).map(layer => layer.id));
    let nextLayerId = state.scene.nextLayerId;
    let id;

    do {
        id = `layer-${nextLayerId++}`;
    } while(usedIds.has(id));

    return { id, nextLayerId };
}

function createLayer(state, name, type) {
    const { id, nextLayerId } = allocateLayer(state);

    const layer = {
        id,
        name,
        type,
        level: 0,
        sourceHasLevel: false,
        visible: true,
        opacity: 1,
        order: state.layers.length,
        hOffset: 0,
        zOffset: 0,
        dirty: true,
        ...(type === "group" ? { layers: [] } : { placements: [], objects: [] }),
    };

    return {
        ...state,
        scene: { ...state.scene, nextLayerId },
        layers: normalizeOrder([...state.layers, layer]),
    };
}

export function createTileLayer(state, name = "Tile Layer") {
    return createLayer(state, name, "tile");
}

export function createObjectLayer(state, name = "Object Layer") {
    return createLayer(state, name, "object");
}

export function createGroup(state, name = "Group") {
    return createLayer(state, name, "group");
}

export function removeLayer(state, id) {
    function removeFrom(layers) {
        const index = layers.findIndex(layer => layer.id === id);
        if(index !== -1) {
            return {
                layers: normalizeOrder(layers.filter((_, layerIndex) => layerIndex !== index)),
                removed: true,
            };
        }

        for(let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
            const layer = layers[layerIndex];
            if(layer.type !== "group") continue;
            const result = removeFrom(layer.layers);
            if(result.removed) {
                const nextLayers = [...layers];
                nextLayers[layerIndex] = { ...layer, layers: result.layers };
                return { layers: nextLayers, removed: true };
            }
        }

        return { layers, removed: false };
    }

    const result = removeFrom(state.layers);
    return result.removed ? { ...state, layers: result.layers } : state;
}

export function moveLayer(state, layerId, destinationGroupId, destinationIndex) {
    if(! Number.isInteger(destinationIndex)) return state;

    const moving = findLayer(state.layers, layerId);
    if(! moving) return state;

    if(destinationGroupId !== null) {
        const destination = findLayer(state.layers, destinationGroupId);
        if(! destination || destination.type !== "group") return state;
        if(destination.id === moving.id ||
            (moving.type === "group" && findLayer(moving.layers, destination.id))) {
            return state;
        }
    }

    function extract(layers) {
        const index = layers.findIndex(layer => layer.id === layerId);
        if(index !== -1) {
            return {
                layers: normalizeOrder(layers.filter((_, layerIndex) => layerIndex !== index)),
                layer: layers[index],
            };
        }

        for(let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
            const layer = layers[layerIndex];
            if(layer.type !== "group") continue;
            const result = extract(layer.layers);
            if(result.layer) {
                const nextLayers = [...layers];
                nextLayers[layerIndex] = { ...layer, layers: result.layers };
                return { layers: nextLayers, layer: result.layer };
            }
        }

        return { layers };
    }

    function insert(layers) {
        if(destinationGroupId === null) {
            const index = Math.max(0, Math.min(destinationIndex, layers.length));
            return normalizeOrder([...layers.slice(0, index), moving, ...layers.slice(index)]);
        }

        const path = findLayerPath(layers, destinationGroupId);
        function insertAtPath(siblings, [index, ...rest]) {
            const nextSiblings = [...siblings];
            const group = siblings[index];
            if(rest.length) {
                nextSiblings[index] = { ...group, layers: insertAtPath(group.layers, rest) };
            } else {
                const childIndex = Math.max(0, Math.min(destinationIndex, group.layers.length));
                const children = [
                    ...group.layers.slice(0, childIndex),
                    moving,
                    ...group.layers.slice(childIndex),
                ];
                nextSiblings[index] = { ...group, layers: normalizeOrder(children) };
            }
            return nextSiblings;
        }

        return insertAtPath(layers, path);
    }

    const extracted = extract(state.layers);
    const layers = insert(extracted.layers);
    return { ...state, layers };
}

export function countPlacements(layers) {
    return traverseLayers(layers).reduce(
        (count, layer) => count + (Array.isArray(layer.placements) ? layer.placements.length : 0),
        0
    );
}

export function createHistory(initialState, label = "Open project") {
    let nextRevision = 1;
    let history = [{ revision: 0, label, state: structuredClone(initialState) }];
    let currentIndex = 0;
    let savedRevision = 0;

    function current() {
        return structuredClone(history[currentIndex].state);
    }

    return {
        current,
        entries() {
            return history.map(entry => ({
                label: entry.label,
                state: structuredClone(entry.state),
            }));
        },
        index() {
            return currentIndex;
        },
        push(state, nextLabel) {
            history = history.slice(0, currentIndex + 1);
            history.push({ revision: nextRevision++, label: nextLabel, state: structuredClone(state) });
            currentIndex = history.length - 1;
            return current();
        },
        undo() {
            if(currentIndex > 0) currentIndex--;
            return current();
        },
        redo() {
            if(currentIndex < history.length - 1) currentIndex++;
            return current();
        },
        goTo(index) {
            if(Number.isInteger(index) && index >= 0 && index < history.length) {
                currentIndex = index;
            }
            return current();
        },
        reset(state, nextLabel = "Open project") {
            const revision = nextRevision++;
            history = [{ revision, label: nextLabel, state: structuredClone(state) }];
            currentIndex = 0;
            savedRevision = revision;
            return current();
        },
        markSaved() {
            savedRevision = history[currentIndex].revision;
        },
        isDirty() {
            return history[currentIndex].revision !== savedRevision;
        },
    };
}
