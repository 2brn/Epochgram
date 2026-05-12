
export {};

import "./similarity-embed.worker/console-silence";
import { installSimilarityEmbedWorkerHandler } from "./similarity-embed.worker/handler";

installSimilarityEmbedWorkerHandler();
