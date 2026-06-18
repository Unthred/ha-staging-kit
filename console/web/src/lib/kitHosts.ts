/** Example hostnames when split DNS routes *.yeradonkey.com via HAProxy (HTTPS). */
export const KIT_FQDN = {
  prodHa: "https://home.yeradonkey.com",
  stagingHa: "https://ha-staging.yeradonkey.com",
  kitConsole: "https://ha-staging-kit.yeradonkey.com",
  /** MQTT must resolve to the kit Docker host (port 1883), not HAProxy — set KIT_MQTT_BROKER when you have one. */
  mqttBrokerHint: "192.168.13.1",
} as const;
