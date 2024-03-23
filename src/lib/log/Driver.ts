import { SortedList } from "alcalzone-shared/sorted-list";
import winston from "winston";
import { isCommandClassContainer } from "../commandclass/ICommandClassContainer";
import { Transaction } from "../driver/Transaction";
import {
	FunctionType,
	MessagePriority,
	MessageType,
} from "../message/Constants";
import { Message, ResponseRole } from "../message/Message";
import {
	createLogTransports,
	getDirectionPrefix,
	isLoglevelVisible,
	tagify,
	ZWaveLogger,
} from "./shared";

export const DRIVER_LABEL = "DRIVER";
const DRIVER_LOGLEVEL = "verbose";
const SENDQUEUE_LOGLEVEL = "silly";

if (!winston.loggers.has("driver")) {
	winston.loggers.add("driver", {
		transports: createLogTransports(DRIVER_LABEL),
	});
}
const logger: ZWaveLogger = winston.loggers.get("driver");
const isDriverLogVisible = isLoglevelVisible(DRIVER_LOGLEVEL);
const isSendQueueLogVisible = isLoglevelVisible(SENDQUEUE_LOGLEVEL);

/**
 * Logs a message
 * @param msg The message to output
 */
export function print(
	message: string,
	level?: "debug" | "verbose" | "warn" | "error" | "info",
): void {
	const actualLevel = level || DRIVER_LOGLEVEL;
	if (!isLoglevelVisible(actualLevel)) return;

	logger.log({
		level: actualLevel,
		message,
		direction: getDirectionPrefix("none"),
	});
}

/**
 * Serializes a message that starts a transaction, i.e. a message that is sent and may expect a response
 */
export function transaction(transaction: Transaction): void {
	if (!isDriverLogVisible) return;

	const { message } = transaction;
	const primaryTags: string[] = getPrimaryTagsForMessage(message);

	// On the first attempt, we print the basic information about the transaction
	const secondaryTags: string[] = [];
	if (transaction.sendAttempts === 1) {
		secondaryTags.push(`P: ${MessagePriority[transaction.priority]}`);
	} else {
		// On later attempts, we print the send attempts
		secondaryTags.push(
			`attempt ${transaction.sendAttempts}/${transaction.maxSendAttempts}`,
		);
	}

	logger.log({
		level: DRIVER_LOGLEVEL,
		primaryTags: tagify(primaryTags),
		secondaryTags: tagify(secondaryTags),
		message: "",
		// Since we are programming a controller, the first message of a transaction is always outbound
		// (not to confuse with the message type, which may be Request or Response)
		direction: getDirectionPrefix("outbound"),
	});
}

/** Logs information about a message that is received as a response to a transaction */
export function transactionResponse(
	message: Message,
	role: ResponseRole,
): void {
	if (!isDriverLogVisible) return;

	const primaryTags: string[] = getPrimaryTagsForMessage(message);
	const secondaryTags = [role];

	logger.log({
		level: DRIVER_LOGLEVEL,
		primaryTags: tagify(primaryTags),
		secondaryTags: tagify(secondaryTags),
		message: "",
		// Since we are programming a controller, responses are always inbound
		// (not to confuse with the message type, which may be Request or Response)
		direction: getDirectionPrefix("inbound"),
	});
}

function getPrimaryTagsForMessage(message: Message): string[] {
	return [
		message.type === MessageType.Request ? "REQ" : "RES",
		FunctionType[message.functionType],
	];
}

/** Logs whats currently in the driver's send queue */
export function sendQueue(queue: SortedList<Transaction>): void {
	if (!isSendQueueLogVisible) return;

	let message = "Send queue:";
	if (queue.length > 0) {
		for (const trns of queue) {
			// TODO: This formatting should be shared with the other logging methods
			const node = trns.message.getNodeUnsafe();
			const prefix =
				trns.message.type === MessageType.Request ? "[REQ]" : "[RES]";
			const postfix =
				node != undefined
					? ` [Node ${node.id}, ${
							node.isAwake() ? "awake" : "asleep"
					  }]`
					: "";
			const command = isCommandClassContainer(trns.message)
				? ` (${trns.message.command.constructor.name})`
				: "";
			message += `\n· ${prefix} ${
				FunctionType[trns.message.functionType]
			}${command}${postfix}`;
		}
	} else {
		message += " (empty)";
	}
	logger.log({
		level: SENDQUEUE_LOGLEVEL,
		message,
		secondaryTags: `(${queue.length} message${
			queue.length === 1 ? "" : "s"
		})`,
		direction: getDirectionPrefix("none"),
	});
}
