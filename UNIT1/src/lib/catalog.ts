// Catalog of YouTube channels the radio knows how to play.
//
// This is the ONLY source of truth about channels: the model receives this
// list, the output schema only accepts these IDs, and the code checks the ID
// again before executing anything.
//
// The channelIds are the real YouTube IDs (they start with "UC" and are 24
// characters long). To add a channel: on YouTube, open the channel's
// description → "Share channel" → "Copy channel ID".

export interface Channel {
  /** Stable YouTube channel identifier. This is what travels between model and code. */
  channelId: string;
  /** "Official" name the radio says out loud. */
  name: string;
  /** Ways people refer to it when speaking. They help the model recognize it. */
  aliases: string[];
}

export const CATALOG = [
  {
    channelId: "UC7mJ2EDXFomeDIRFu5FtEbA",
    name: "OLGA",
    aliases: ["olga", "la olga", "olga channel"],
  },
  {
    channelId: "UCEKbBDfanOeB3LqZio_nLdQ",
    name: "Rebord",
    aliases: ["rebord"],
  },
  {
    channelId: "UCunKpj3RZOlrp1jpETmScWg",
    name: "Martín Cirio",
    aliases: ["martin cirio", "martín cirio", "cirio"],
  },
  {
    channelId: "UCXWDobBq29pIOivFql-0aGA",
    name: "Muy Pute",
    aliases: ["muy pute"],
  },
  {
    channelId: "UCi0YGKwQGE-r1GtEAgX1vwQ",
    name: "Marcelo Longobardi",
    aliases: ["marcelo longobardi", "longobardi"],
  },
  {
    channelId: "UCC1kfsMJko54AqxtcFECt-A",
    name: "Urbana Play",
    aliases: ["urbana play", "urbana"],
  },
] as const satisfies readonly Channel[];

/** Tuple with every ID. Zod uses it to build an enum: the model cannot invent IDs. */
export const CHANNEL_IDS = CATALOG.map((c) => c.channelId) as unknown as [
  string,
  ...string[],
];

/** Lookup by ID. Returns undefined if the ID is not in the catalog. */
export function findChannel(channelId: string): Channel | undefined {
  return CATALOG.find((c) => c.channelId === channelId);
}
