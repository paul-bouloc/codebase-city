# city

Imperative 3D city engine (three.js), independent of React.

Each folder may import from the folders above it, never from those below:

- `world/`: the city's data, its units and its seeded randomness
- `render/`: shared three.js building blocks (meshes, palette, light, screen-space lines, fading)
- `terrain/`: islands, plateaux, canals, gardens and the sea
- `buildings/`: archetypes, their variants, geometry and placement on the lots
- `waterways/`: bridges, ferries, ports and the routes boats sail along
- `decor/`: trees, rocks and boats, moored or sailing
- `flows/`: the links and cycles drawn for a selection
- `interaction/`: picking, hover, selection and the marks they leave
- `engine/`: the `CityEngine`, its camera and its controls
