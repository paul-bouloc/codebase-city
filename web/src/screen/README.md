# screen

The city screen in React: it mounts the engine and lays the interface around it.
One folder per part of the interface; `parts/` holds the pieces several of them share.
It may import from `city/`, `data/` and `ui/`; none of them imports from it.
