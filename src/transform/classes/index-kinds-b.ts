/** AI, realtime and microservice kinds: Agent, McpServer, Tool, their triggers, realtime v1/v2 kinds, Microservice and its components. */
import type { ClassEncoder } from "../registry.js";
import { Agent } from "./Agent.js";
import { AgentTrigger } from "./AgentTrigger.js";
import { Channel } from "./Channel.js";
import { ChannelTrigger } from "./ChannelTrigger.js";
import { Container } from "./Container.js";
import { ContainerVolume } from "./ContainerVolume.js";
import { Deployment } from "./Deployment.js";
import { Ingress } from "./Ingress.js";
import { McpServer } from "./McpServer.js";
import { McpServerTrigger } from "./McpServerTrigger.js";
import { Message } from "./Message.js";
import { Microservice } from "./Microservice.js";
import { MicroserviceChart } from "./MicroserviceChart.js";
import { MicroserviceConfig } from "./MicroserviceConfig.js";
import { MicroserviceVolume } from "./MicroserviceVolume.js";
import { RealtimeChannel } from "./RealtimeChannel.js";
import { RealtimeServer } from "./RealtimeServer.js";
import { RealtimeServerTrigger } from "./RealtimeServerTrigger.js";
import { RealtimeTrigger } from "./RealtimeTrigger.js";
import { Tool } from "./Tool.js";

export const KIND_CLASSES_B: Record<string, ClassEncoder> = {
  Agent,
  AgentTrigger,
  Channel,
  ChannelTrigger,
  Container,
  ContainerVolume,
  Deployment,
  Ingress,
  McpServer,
  McpServerTrigger,
  Message,
  Microservice,
  MicroserviceChart,
  MicroserviceConfig,
  MicroserviceVolume,
  RealtimeChannel,
  RealtimeServer,
  RealtimeServerTrigger,
  RealtimeTrigger,
  Tool,
};
