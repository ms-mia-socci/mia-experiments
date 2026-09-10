import "dotenv/config";
import { createProcessor } from "./runtime.js";

const processor = await createProcessor();
const summary = await processor.poll();
console.log(JSON.stringify(summary, null, 2));
