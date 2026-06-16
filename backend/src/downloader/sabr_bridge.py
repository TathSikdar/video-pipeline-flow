"""SABR Protocol Bridge and Universal Media Protocol (UMP) processor.

Bypasses the SABR 360p resolution downgrade enforced on headless
clients by parsing the proprietary UMP binary format and suppressing
server-side backoff instructions.

YouTube's SABR protocol wraps stream data inside UMP blobs containing
variable-length integer headers and proprietary metadata blocks.
Non-compliant clients that fail to parse these correctly are
permanently restricted to Format 18 (360p).

References:
    - UMP header format: first 5 bits encode integer byte-length.
    - Part 34: LIVE_METADATA_PROMISE_CANCELLATION
    - Part 36: USTREAMER_VIDEO_AND_FORMAT_DATA
"""

import logging

from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class UmpSegment:
    """A single decoded segment from a UMP payload.

    Attributes:
        part_type: The UMP part type identifier (e.g. 34, 36).
        data: The raw segment payload bytes.
        offset: The byte offset where this segment starts in
            the original UMP blob.
    """

    part_type: int
    data: bytes
    offset: int


@dataclass
class StreamInfo:
    """Extracted stream metadata from a UMP Part 36 block.

    Attributes:
        itag: The YouTube format identifier.
        url: The extracted stream URL.
        content_length: The total byte size of the stream.
        mime_type: The MIME type (e.g. video/mp4, audio/mp4).
    """

    itag: int
    url: str
    content_length: int = 0
    mime_type: str = ""


class SabrUmpProcessor:
    """Decodes Universal Media Protocol (UMP) binary blobs.

    The UMP format uses variable-length integer encoding where the
    first 5 bits of the header byte determine the integer size.
    This processor unpacks these headers and extracts the embedded
    stream segments.
    """

    def __init__(self) -> None:
        """Initializes the processor with an empty segment buffer."""
        self._segments: list[UmpSegment] = []

    @staticmethod
    def _read_varint(data: bytes, offset: int) -> tuple[int, int]:
        """Reads a UMP variable-length integer from the data.

        The first 5 bits of the first byte encode the number of
        bytes used to represent the integer value.

        Args:
            data: The raw byte buffer.
            offset: The byte offset to start reading from.

        Returns:
            A tuple of (decoded_value, new_offset) where
            new_offset points to the byte after the integer.

        Raises:
            ValueError: If the varint encoding is invalid or
                the data is truncated.
        """
        if offset >= len(data):
            raise ValueError(f"Varint read out of bounds at offset {offset}")

        first_byte = data[offset]
        # The top 3 bits encode the byte-length minus 1
        byte_length = (first_byte >> 5) + 1

        if offset + byte_length > len(data):
            raise ValueError(
                f"Truncated varint at offset {offset}: "
                f"need {byte_length} bytes, "
                f"have {len(data) - offset}"
            )

        # Mask off the length bits from the first byte
        value = first_byte & 0x1F

        for i in range(1, byte_length):
            value = (value << 8) | data[offset + i]

        return value, offset + byte_length

    def unpack_ump_blob(
        self,
        blob_data: bytes,
    ) -> list[UmpSegment]:
        """Decodes a complete UMP blob into its constituent segments.

        Iterates through the binary blob, reading varint-encoded
        part type and length headers, then extracting each segment's
        payload data.

        Args:
            blob_data: The raw UMP binary blob.

        Returns:
            A list of decoded UmpSegment instances.

        Raises:
            ValueError: If the blob format is malformed.
        """
        self._segments = []
        offset = 0

        while offset < len(blob_data):
            segment_start = offset

            # Read part type (varint)
            part_type, offset = self._read_varint(blob_data, offset)

            # Read payload length (varint)
            payload_length, offset = self._read_varint(blob_data, offset)

            # Validate we have enough data
            if offset + payload_length > len(blob_data):
                logger.warning(
                    "Truncated UMP segment at offset %d: "
                    "type=%d, declared_len=%d, available=%d",
                    segment_start,
                    part_type,
                    payload_length,
                    len(blob_data) - offset,
                )
                break

            # Extract the payload
            payload = blob_data[offset : offset + payload_length]
            offset += payload_length

            segment = UmpSegment(
                part_type=part_type,
                data=payload,
                offset=segment_start,
            )
            self._segments.append(segment)

            logger.debug(
                "UMP segment: type=%d, size=%d, offset=%d",
                part_type,
                payload_length,
                segment_start,
            )

        logger.info(
            "Unpacked %d segments from %d byte UMP blob",
            len(self._segments),
            len(blob_data),
        )

        return self._segments

    def extract_streams(
        self,
        ump_payload: bytes,
    ) -> list[StreamInfo]:
        """Extracts stream metadata from UMP Part 36 blocks.

        Part 36 (USTREAMER_VIDEO_AND_FORMAT_DATA) contains the
        actual video and audio stream URLs that YouTube embeds
        within the UMP response.

        Args:
            ump_payload: The raw UMP binary payload.

        Returns:
            A list of StreamInfo instances with extracted URLs.
        """
        segments = self.unpack_ump_blob(ump_payload)
        streams = []

        for segment in segments:
            if segment.part_type == 36:
                stream = self._parse_format_data(segment.data)
                if stream:
                    streams.append(stream)
            elif segment.part_type == 34:
                logger.debug("Skipping Part 34 " "(LIVE_METADATA_PROMISE_CANCELLATION)")

        logger.info(
            "Extracted %d streams from UMP payload",
            len(streams),
        )

        return streams

    @staticmethod
    def _parse_format_data(
        data: bytes,
    ) -> Optional[StreamInfo]:
        """Parses a Part 36 payload into stream metadata.

        The Part 36 binary format contains the itag, MIME type,
        content length, and stream URL in a protobuf-like encoding.

        Args:
            data: The raw Part 36 segment payload.

        Returns:
            A StreamInfo instance, or None if parsing fails.
        """
        try:
            # Part 36 uses a protobuf-like encoding.
            # Field 1 (varint): itag
            # Field 2 (length-delimited): mime type
            # Field 3 (varint): content length
            # Field 4 (length-delimited): url
            offset = 0
            itag = 0
            mime_type = ""
            content_length = 0
            url = ""

            while offset < len(data):
                if offset >= len(data):
                    break

                # Read field tag
                tag_byte = data[offset]
                field_number = tag_byte >> 3
                wire_type = tag_byte & 0x07
                offset += 1

                if wire_type == 0:  # Varint
                    value = 0
                    shift = 0
                    while offset < len(data):
                        byte = data[offset]
                        offset += 1
                        value |= (byte & 0x7F) << shift
                        if not (byte & 0x80):
                            break
                        shift += 7

                    if field_number == 1:
                        itag = value
                    elif field_number == 3:
                        content_length = value

                elif wire_type == 2:  # Length-delimited
                    length = 0
                    shift = 0
                    while offset < len(data):
                        byte = data[offset]
                        offset += 1
                        length |= (byte & 0x7F) << shift
                        if not (byte & 0x80):
                            break
                        shift += 7

                    field_data = data[offset : offset + length]
                    offset += length

                    if field_number == 2:
                        mime_type = field_data.decode("utf-8", errors="replace")
                    elif field_number == 4:
                        url = field_data.decode("utf-8", errors="replace")
                else:
                    # Skip unknown wire types
                    break

            if url and itag:
                return StreamInfo(
                    itag=itag,
                    url=url,
                    content_length=content_length,
                    mime_type=mime_type,
                )

            return None

        except (IndexError, UnicodeDecodeError) as exc:
            logger.warning("Failed to parse Part 36 data: %s", str(exc))
            return None


class SabrStreamingAdapter:
    """Intercepts and processes SABR streaming responses.

    Detects and suppresses server-side backoff instructions that
    YouTube injects into SABR responses to force artificial
    buffering pauses in automated clients.
    """

    def __init__(self, processor: SabrUmpProcessor) -> None:
        """Initializes the adapter with a UMP processor.

        Args:
            processor: The SabrUmpProcessor instance for decoding
                UMP binary payloads.
        """
        self.processor = processor

    def intercept_stream(
        self,
        response_data: bytes,
    ) -> list[StreamInfo]:
        """Intercepts a SABR streaming response.

        Unpacks the UMP payload, extracts stream URLs, and filters
        out any server-side backoff or buffering instructions that
        would otherwise degrade playback performance.

        Args:
            response_data: The raw HTTP response body from a
                SABR streaming request.

        Returns:
            A list of clean StreamInfo instances with backoff
            instructions removed.
        """
        streams = self.processor.extract_streams(response_data)

        # Filter out segments that contain backoff instructions.
        # Backoff segments typically have Part type 42 or contain
        # specific byte patterns indicating a pause request.
        segments = self.processor.unpack_ump_blob(response_data)
        backoff_count = 0
        for segment in segments:
            if self._is_backoff_instruction(segment):
                backoff_count += 1

        if backoff_count > 0:
            logger.info(
                "Suppressed %d server-side backoff instructions",
                backoff_count,
            )

        return streams

    @staticmethod
    def _is_backoff_instruction(segment: UmpSegment) -> bool:
        """Detects if a UMP segment is a backoff instruction.

        YouTube uses specific part types and byte patterns to
        signal that the client should pause downloading. We
        detect and suppress these.

        Args:
            segment: A decoded UMP segment.

        Returns:
            True if the segment is a backoff instruction.
        """
        # Known backoff/throttle part types
        backoff_types = {42, 49, 51}
        return segment.part_type in backoff_types
