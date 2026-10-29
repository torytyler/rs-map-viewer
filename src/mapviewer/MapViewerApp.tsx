import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { registerSerializer } from "threads";
import WebFont from "webfontloader";

import { AmbientDirector } from "../ambient/AmbientDirector";
import { parseAmbientOptions } from "../ambient/AmbientConfig";
import { OsrsLoadingBar } from "../components/rs/loading/OsrsLoadingBar";
import { DownloadProgress } from "../rs/cache/CacheFiles";
import { formatBytes } from "../util/BytesUtil";
import { isIos, isLiteMode, isScreenSaver, isWallpaperEngine } from "../util/DeviceUtil";
import { fetchCacheList, loadCacheFiles } from "./Caches";
import { MapViewer } from "./MapViewer";
import { MapViewerContainer } from "./MapViewerContainer";
import { WEBGL, getAvailableRenderers } from "./MapViewerRenderers";
import { fetchNpcSpawns, getNpcSpawnsUrl } from "./data/npc/NpcSpawn";
import { fetchObjSpawns } from "./data/obj/ObjSpawn";
import { renderDataLoaderSerializer } from "./worker/RenderDataLoader";
import { RenderDataWorkerPool } from "./worker/RenderDataWorkerPool";

registerSerializer(renderDataLoaderSerializer);

WebFont.load({
    custom: {
        families: ["OSRS Bold", "OSRS Small"],
    },
});

const cachesPromise = fetchCacheList();

// A screen saver can run one viewer per display, so keep the pool small there and
// tiny on secondary displays.
const workerPool = RenderDataWorkerPool.create(
    isWallpaperEngine || isLiteMode ? 1 : isScreenSaver ? 2 : 4,
);

function MapViewerApp() {
    const [searchParams, setSearchParams] = useSearchParams();

    const [errorMessage, setErrorMessage] = useState<string>();
    const [downloadProgress, setDownloadProgress] = useState<DownloadProgress>();
    const [mapViewer, setMapViewer] = useState<MapViewer>();

    useEffect(() => {
        const abortController = new AbortController();

        const load = async () => {
            const objSpawnsPromise = fetchObjSpawns();

            const cacheList = await cachesPromise;
            if (!cacheList) {
                setErrorMessage("Failed to load cache list");
                throw new Error("No caches found");
            }

            const cacheNameParam = searchParams.get("cache");
            const ambientOptions = parseAmbientOptions(searchParams);
            const legacyInfo = cacheList.caches.find((cache) => cache.name.startsWith("rs2-295"));

            let cacheInfo = cacheList.latest;
            if (ambientOptions?.era === "legacy" && legacyInfo) {
                cacheInfo = legacyInfo;
            }
            if (cacheNameParam) {
                const foundCache = cacheList.caches.find((cache) => cache.name === cacheNameParam);
                if (foundCache) {
                    cacheInfo = foundCache;
                }
            }

            const [cache, objSpawns, npcSpawns] = await Promise.all([
                loadCacheFiles(cacheInfo, abortController.signal, setDownloadProgress),
                objSpawnsPromise,
                fetchNpcSpawns(getNpcSpawnsUrl(cacheInfo)),
            ]);

            const mapImageCache = await caches.open("map-images");

            const availableRenderers = getAvailableRenderers();
            if (availableRenderers.length === 0) {
                setErrorMessage("No renderers available");
                return;
            }

            // Add some way to get preferred renderer
            const rendererType = availableRenderers[0];

            const mapViewer = new MapViewer(
                workerPool,
                cacheList,
                objSpawns,
                npcSpawns,
                mapImageCache,
                rendererType,
                cache,
            );
            mapViewer.applySearchParams(searchParams);

            if (ambientOptions) {
                // Switching eras means loading a different cache into the live
                // viewer, exactly like the cache dropdown in the debug panel.
                mapViewer.ambient = new AmbientDirector(mapViewer, {
                    ...ambientOptions,
                    latestCache: cacheInfo.name,
                    legacyCache: legacyInfo?.name,
                    switchEra: async (cacheName: string) => {
                        const target = cacheList.caches.find((c) => c.name === cacheName);
                        if (!target) {
                            return false;
                        }
                        const [loadedCache, npcSpawns] = await Promise.all([
                            loadCacheFiles(target),
                            fetchNpcSpawns(getNpcSpawnsUrl(target)),
                        ]);
                        mapViewer.npcSpawns = npcSpawns;
                        mapViewer.initCache(loadedCache);
                        return true;
                    },
                });
            }

            mapViewer.init();

            setDownloadProgress(undefined);
            setMapViewer(mapViewer);
        };

        if (isIos) {
            setErrorMessage("iOS is not supported.");
        } else {
            load().catch(console.error);
        }

        return () => {
            abortController.abort();
        };
    }, []);

    let content: JSX.Element | undefined;
    if (errorMessage) {
        content = <div className="center-container max-height content-text">{errorMessage}</div>;
    } else if (downloadProgress) {
        const formattedCacheSize = formatBytes(downloadProgress.total);
        const progress = ((downloadProgress.current / downloadProgress.total) * 100) | 0;
        content = (
            <div className="center-container max-height">
                <OsrsLoadingBar
                    text={`Downloading cache (${formattedCacheSize})`}
                    progress={progress}
                />
            </div>
        );
    } else if (mapViewer) {
        content = <MapViewerContainer mapViewer={mapViewer} ambient={mapViewer.ambient} />;
    }

    return <div className="App max-height">{content}</div>;
}

export default MapViewerApp;
