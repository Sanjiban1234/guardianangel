/// <reference types="vite/client" />
interface ImportMetaEnv { readonly VITE_GOOGLE_MAPS_API_KEY?: string; }
declare namespace google { namespace maps { class Map { constructor(node: Element, options: object); } class Marker { constructor(options: object); setPosition(position: object): void; } } }
interface Window { google?: { maps?: typeof google.maps }; }
