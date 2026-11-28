package com.ranobe.epub.epub;

/** Thrown when a project cannot be exported as a valid EPUB (user-facing message in Russian). */
public final class EpubValidationException extends Exception {
    public EpubValidationException(String message) {
        super(message);
    }
}
