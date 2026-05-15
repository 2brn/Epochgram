export interface EpochSettings {
	openEpochViewOnStartup: boolean;
	enableAnimation: boolean;
	trackChanges: boolean;
	claimKeyPreview?: string;
	installId?: string;
	devicePublicKey?: string;
	activationEnvelope?: string;
	activationWitness?: string;
	activationGenerationFloor?: number;
	activationStatus?: string;
	activationError?: string;
	lastValidationAt?: string;
	lastValidatedAt?: string;
	timelineFilters?: {
		showDraftsOnly?: boolean;
		showAttachments?: boolean;
		showTrackedChanges?: boolean;
		showParsed?: boolean;
	};
	parseDatesInFrontmatter?: boolean;
	yamlDateProperty: string;
	yamlDescriptionProperty: string;
	filenameWordsCount: number;
	summaryWordsCount: number;
	summarizeAI: boolean;
	generateEpochs: boolean;
	openAiBridgeOnStartup: boolean;
	// Internal flag: used to apply one-time defaults on the first successful Pro activation.
	proActivatedOnce?: boolean;
	// Pro-only similarity tuning (undefined => defaults)
	similarityUseLinks?: boolean;
	similarityUseTags?: boolean;
	similarityTitleJwThreshold?: number;
	// Advanced similarity models (undefined/empty => defaults)
	similarityEmbeddingModelId?: string;
	similarityZeroShotModelId?: string;
	similarityThreshold: number;
	similarityZeroShotMinScore?: number;
	aiBridgeOptions?: {
		settingsYaml?: string;
	};
	aiBridgeServer?: {
		token: string;
		port?: number;
	};
}

export const DEFAULT_SETTINGS: EpochSettings = {
	openEpochViewOnStartup: true,
	enableAnimation: true,
	trackChanges: true,
	timelineFilters: {
		showDraftsOnly: false,
		showAttachments: false,
		showTrackedChanges: true,
		showParsed: true
	},
	parseDatesInFrontmatter: false,
	yamlDateProperty: "date",
	yamlDescriptionProperty: "description",
	filenameWordsCount: 2,
	summaryWordsCount: 5,
	summarizeAI: false,
	generateEpochs: false,
	openAiBridgeOnStartup: false,
	proActivatedOnce: false,
	similarityEmbeddingModelId: undefined,
	similarityZeroShotModelId: undefined,
	similarityThreshold: 0,
	similarityZeroShotMinScore: 0,
	aiBridgeOptions: undefined,
	aiBridgeServer: undefined,
	claimKeyPreview: "",
	installId: "",
	devicePublicKey: "",
	activationEnvelope: "",
	activationWitness: "",
	activationGenerationFloor: 0,
	activationStatus: "inactive",
	activationError: "",
	lastValidationAt: "",
	lastValidatedAt: ""
};
