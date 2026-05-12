type NodeDetectionMaskSnapshot = {
	originalGlobalProcess: any;
	hidGlobalProcess: boolean;
	mutatedNodeVersion: boolean;
	originalNodeVersion: any;
	deletedNodeVersion: boolean;
	mutatedReleaseName: boolean;
	originalReleaseName: any;
	deletedReleaseName: boolean;
};

export function detectNodeLikeEnvironment(g: any): boolean {
	try {
		const p = g?.process;
		return (
			typeof p === "object" &&
			p !== null &&
			typeof p.versions === "object" &&
			p.versions !== null &&
			typeof p.versions.node === "string"
		);
	} catch {
		return false;
	}
}

function trySet(obj: any, key: string, value: any): boolean {
	try {
		obj[key] = value;
		return true;
	} catch {
		return false;
	}
}

function tryDelete(obj: any, key: string): boolean {
	try {
		return delete obj[key];
	} catch {
		return false;
	}
}

function tryDefineValue(obj: any, key: string, value: any): boolean {
	try {
		Object.defineProperty(obj, key, {
			value,
			writable: true,
			configurable: true,
			enumerable: true
		});
		return true;
	} catch {
		return false;
	}
}

export function maskNodeDetectionForBrowserLibraries(g: any): NodeDetectionMaskSnapshot {
	const snapshot: NodeDetectionMaskSnapshot = {
		originalGlobalProcess: undefined,
		hidGlobalProcess: false,
		mutatedNodeVersion: false,
		originalNodeVersion: undefined,
		deletedNodeVersion: false,
		mutatedReleaseName: false,
		originalReleaseName: undefined,
		deletedReleaseName: false
	};

	snapshot.originalGlobalProcess = g?.process;

	const p = g?.process;
	// Prefer mutating the existing process object so `typeof process === 'object'` stays true
	// but `process.versions.node` is no longer a string.
	try {
		if (p && typeof p === "object") {
			const versions = (p as any).versions;
			if (versions && typeof versions === "object") {
				if ("node" in versions) {
					snapshot.originalNodeVersion = (versions as any).node;
					if (trySet(versions, "node", undefined)) snapshot.mutatedNodeVersion = true;
					else if (tryDefineValue(versions, "node", undefined)) snapshot.mutatedNodeVersion = true;
					else if (tryDelete(versions, "node")) snapshot.deletedNodeVersion = true;
				}
			}

			const release = (p as any).release;
			if (release && typeof release === "object") {
				if ("name" in release) {
					snapshot.originalReleaseName = (release as any).name;
					if (trySet(release, "name", "")) snapshot.mutatedReleaseName = true;
					else if (tryDefineValue(release, "name", "")) snapshot.mutatedReleaseName = true;
					else if (tryDelete(release, "name")) snapshot.deletedReleaseName = true;
				}
			}
		}
	} catch {
		// ignore
	}

	// If we still look Node-like, hide process globally as a last resort.
	if (detectNodeLikeEnvironment(g)) {
		try {
			if (trySet(g, "process", undefined)) snapshot.hidGlobalProcess = true;
			else if (tryDefineValue(g, "process", undefined)) snapshot.hidGlobalProcess = true;
			else if (tryDelete(g, "process")) snapshot.hidGlobalProcess = true;
		} catch {
			// ignore
		}
	}

	return snapshot;
}

export function restoreNodeDetectionMask(g: any, snapshot: NodeDetectionMaskSnapshot): void {
	try {
		if (snapshot.hidGlobalProcess) {
			trySet(g, "process", snapshot.originalGlobalProcess);
			tryDefineValue(g, "process", snapshot.originalGlobalProcess);
		}

		const p = snapshot.originalGlobalProcess;
		if (p && typeof p === "object") {
			const versions = (p as any).versions;
			if (versions && typeof versions === "object") {
				if (snapshot.mutatedNodeVersion) {
					trySet(versions, "node", snapshot.originalNodeVersion);
				}
				if (snapshot.deletedNodeVersion) {
					tryDefineValue(versions, "node", snapshot.originalNodeVersion);
				}
			}

			const release = (p as any).release;
			if (release && typeof release === "object") {
				if (snapshot.mutatedReleaseName) {
					trySet(release, "name", snapshot.originalReleaseName);
				}
				if (snapshot.deletedReleaseName) {
					tryDefineValue(release, "name", snapshot.originalReleaseName);
				}
			}
		}
	} catch {
		// ignore
	}
}
