import type { FileIndexData } from "./types";

export function createEmptyFileIndex(): FileIndexData {
	return { cdate: null, namedDate: null, dateProp: null, contentDates: [] };
}
