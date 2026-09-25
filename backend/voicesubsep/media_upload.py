"""Own multipart media spools from parsing through endpoint completion.

Starlette's parser only closes incomplete spools for MultiPartException. A
disconnect, cancellation or disk error can happen before FastAPI has a FormData
object to close, so this dependency owns those files independently of parsing.
File bytes remain unbounded; the parser's spool threshold only controls when it
moves bytes from memory to a temporary file.
"""

from __future__ import annotations

from collections.abc import AsyncIterator

from fastapi import HTTPException, Request
from python_multipart.exceptions import MultipartParseError
from starlette.datastructures import UploadFile
from starlette.formparsers import MultiPartException, MultiPartParser
from starlette.requests import ClientDisconnect


class _MediaParser(MultiPartParser):
    completed = False

    def on_end(self) -> None:
        self.completed = True
        super().on_end()

    def close_spools(self) -> None:
        # Deliberately synchronous: an already-cancelled task must not skip
        # cleanup at an await. At most one local spool exists for this route.
        # The list also contains files from an unfinished multipart part.
        for spool in self._files_to_close_on_error:
            try:
                spool.close()
            except OSError:
                # Continue cleanup without masking the original parse/cancel
                # error. TemporaryFile.close releases its handle even if its
                # buffered flush failed (for example on a full disk).
                pass


async def uploaded_media(request: Request) -> AsyncIterator[UploadFile]:
    """Yield the sole ``file`` part and always release its temporary storage."""
    content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if content_type != "multipart/form-data":
        raise HTTPException(415, "Choose a multipart audio or video upload.")

    parser = _MediaParser(request.headers, request.stream(), max_files=1, max_fields=0)
    try:
        try:
            form = await parser.parse()
        except OSError:
            raise HTTPException(
                507,
                "The media could not be saved. Check available disk space and temporary directory permissions.",
            ) from None
        except (MultiPartException, MultipartParseError):
            raise HTTPException(400, "Invalid multipart media upload.") from None
        except ClientDisconnect:
            raise HTTPException(400, "Media upload was interrupted.") from None

        if not parser.completed:
            raise HTTPException(400, "The multipart media upload is incomplete.")
        items = form.multi_items()
        if len(items) != 1 or items[0][0] != "file" or not isinstance(items[0][1], UploadFile):
            raise HTTPException(422, "Provide one audio or video file in the file field.")
        yield items[0][1]
    finally:
        parser.close_spools()
