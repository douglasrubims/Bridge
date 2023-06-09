import { Kafka, Consumer, Producer } from "kafkajs";

import { KafkaClient } from "./kafka";
import { KafkaConsumer } from "./kafka/consumer";
import { KafkaProducer } from "./kafka/producer";

import { SubscribedTopic } from "../../@types/infra/topics";

import { logger } from "../logs/logger";

class KafkaMessaging {
  private kafkaConsumer: KafkaConsumer;
  private kafkaProducer: KafkaProducer;
  private topics: string[] = [];

  constructor(
    private readonly kafka: Kafka,
    private readonly groupId: string,
    private readonly origin: string,
    private readonly subscribedTopics: SubscribedTopic[]
  ) {
    this.topics = this.subscribedTopics.map(
      topic => `${this.origin}.${topic.name}`
    );

    this.kafkaConsumer = new KafkaConsumer(
      this.kafka,
      this.groupId,
      this.topics
    );

    this.kafkaProducer = new KafkaProducer(this.kafka);
  }

  public async syncTopics(): Promise<void> {
    await this.kafka.admin().connect();

    const topicsMetadata = await this.kafka.admin().fetchTopicMetadata();

    const topicsToCreate = this.topics.filter(
      topic =>
        !topicsMetadata.topics.find(
          topicMetadata => topicMetadata.name === topic
        )
    );

    const topicsToModify = topicsMetadata.topics.filter(topicMetadata => {
      const numPartitions = this.subscribedTopics.find(
        subscribedTopic => subscribedTopic.name === topicMetadata.name
      )?.numPartitions;

      if (!numPartitions) return false;

      return topicMetadata.partitions.length < numPartitions;
    });

    if (topicsToModify.length) {
      logger.log(
        `Modifying partitions for topics: ${topicsToModify
          .map(topicMetadata => topicMetadata.name)
          .join(", ")}`
      );

      await this.kafka.admin().createPartitions({
        validateOnly: false,
        timeout: 5000,
        topicPartitions: topicsToModify.map(topicMetadata => ({
          topic: topicMetadata.name,
          count:
            this.subscribedTopics.find(
              subscribedTopic => subscribedTopic.name === topicMetadata.name
            )?.numPartitions! - topicMetadata.partitions.length
        }))
      });
    }

    if (topicsToCreate.length)
      await this.kafka.admin().createTopics({
        topics: topicsToCreate.map(topic => {
          const numPartitions = this.subscribedTopics.find(
            subscribedTopic => subscribedTopic.name === topic
          )?.numPartitions;

          return {
            topic,
            numPartitions: numPartitions ?? -1,
            replicationFactor: -1,
            configEntries: [
              {
                name: "cleanup.policy",
                value: "delete"
              }
            ]
          };
        })
      });

    await this.kafka.admin().disconnect();
  }

  public async connect(): Promise<void> {
    await Promise.all([
      this.kafkaConsumer.connect(),
      this.kafkaProducer.connect()
    ]);
  }

  public get consumer(): Consumer {
    return this.kafkaConsumer.getInstance();
  }

  public get producer(): Producer {
    return this.kafkaProducer.getInstance();
  }
}

export { KafkaClient, KafkaMessaging };
