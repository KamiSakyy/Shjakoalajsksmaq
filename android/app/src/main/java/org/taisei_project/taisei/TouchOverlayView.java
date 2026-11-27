package org.taisei_project.taisei;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;

import org.libsdl.app.SDLActivity;

import java.util.HashMap;
import java.util.Map;

/**
 * Multi-touch translucent game controller overlay for Taisei Project.
 * Left side: virtual floating joystick (maps to Arrow keys).
 * Right side: SHOOT (Z), FOCUS (Shift), BOMB (X), PAUSE (Esc).
 */
public class TouchOverlayView extends View {

    private static class Button {
        final String label;
        final int keyCode;
        float cx, cy, radius;
        int pointerId = -1;

        Button(String label, int keyCode) {
            this.label = label;
            this.keyCode = keyCode;
        }

        boolean hitTest(float x, float y) {
            float dx = x - cx;
            float dy = y - cy;
            return (dx * dx + dy * dy) <= (radius * radius * 1.25f);
        }
    }

    private final Paint circlePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint pressedPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint strokePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint textPaint = new Paint(Paint.ANTI_ALIAS_FLAG);

    private final Button btnShoot = new Button("SHOT", KeyEvent.KEYCODE_Z);
    private final Button btnFocus = new Button("FOCUS", KeyEvent.KEYCODE_SHIFT_LEFT);
    private final Button btnBomb  = new Button("BOMB", KeyEvent.KEYCODE_X);
    private final Button btnPause = new Button("MENU", KeyEvent.KEYCODE_ESCAPE);
    private final Button[] buttons = new Button[] { btnShoot, btnFocus, btnBomb, btnPause };

    private int stickPointerId = -1;
    private float stickOriginX, stickOriginY;
    private float stickCurX, stickCurY;
    private float stickBaseX, stickBaseY, stickRadius;

    private final Map<Integer, Boolean> keyState = new HashMap<>();

    public TouchOverlayView(Context context) {
        super(context);

        circlePaint.setColor(Color.argb(65, 255, 255, 255));
        circlePaint.setStyle(Paint.Style.FILL);

        pressedPaint.setColor(Color.argb(145, 120, 200, 255));
        pressedPaint.setStyle(Paint.Style.FILL);

        strokePaint.setColor(Color.argb(150, 255, 255, 255));
        strokePaint.setStyle(Paint.Style.STROKE);
        strokePaint.setStrokeWidth(3f);

        textPaint.setColor(Color.argb(220, 255, 255, 255));
        textPaint.setTextAlign(Paint.Align.CENTER);
        textPaint.setFakeBoldText(true);
    }

    @Override
    protected void onSizeChanged(int w, int h, int oldw, int oldh) {
        super.onSizeChanged(w, h, oldw, oldh);
        float unit = Math.min(w, h);

        stickRadius = unit * 0.14f;
        stickBaseX = unit * 0.22f;
        stickBaseY = h - unit * 0.24f;

        float btnR = unit * 0.085f;
        btnShoot.radius = btnR * 1.15f;
        btnShoot.cx = w - unit * 0.16f;
        btnShoot.cy = h - unit * 0.20f;

        btnFocus.radius = btnR;
        btnFocus.cx = w - unit * 0.36f;
        btnFocus.cy = h - unit * 0.16f;

        btnBomb.radius = btnR;
        btnBomb.cx = w - unit * 0.22f;
        btnBomb.cy = h - unit * 0.42f;

        btnPause.radius = btnR * 0.75f;
        btnPause.cx = w - unit * 0.10f;
        btnPause.cy = unit * 0.10f;

        textPaint.setTextSize(unit * 0.036f);
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);

        // Draw virtual stick
        float bx = (stickPointerId != -1) ? stickOriginX : stickBaseX;
        float by = (stickPointerId != -1) ? stickOriginY : stickBaseY;
        canvas.drawCircle(bx, by, stickRadius, circlePaint);
        canvas.drawCircle(bx, by, stickRadius, strokePaint);

        float kx = bx;
        float ky = by;
        if (stickPointerId != -1) {
            float dx = stickCurX - stickOriginX;
            float dy = stickCurY - stickOriginY;
            float dist = (float) Math.hypot(dx, dy);
            if (dist > stickRadius) {
                dx = dx * stickRadius / dist;
                dy = dy * stickRadius / dist;
            }
            kx = stickOriginX + dx;
            ky = stickOriginY + dy;
        }
        canvas.drawCircle(kx, ky, stickRadius * 0.42f, stickPointerId != -1 ? pressedPaint : circlePaint);
        canvas.drawCircle(kx, ky, stickRadius * 0.42f, strokePaint);

        // Draw action buttons
        for (Button b : buttons) {
            Paint fill = (b.pointerId != -1) ? pressedPaint : circlePaint;
            canvas.drawCircle(b.cx, b.cy, b.radius, fill);
            canvas.drawCircle(b.cx, b.cy, b.radius, strokePaint);
            float textY = b.cy - (textPaint.descent() + textPaint.ascent()) / 2f;
            canvas.drawText(b.label, b.cx, textY, textPaint);
        }
    }

    private void setKey(int keyCode, boolean pressed) {
        Boolean prev = keyState.get(keyCode);
        if (prev != null && prev == pressed) {
            return;
        }
        keyState.put(keyCode, pressed);
        if (pressed) {
            SDLActivity.onNativeKeyDown(keyCode);
        } else {
            SDLActivity.onNativeKeyUp(keyCode);
        }
    }

    private void updateStickKeys() {
        if (stickPointerId == -1) {
            setKey(KeyEvent.KEYCODE_DPAD_LEFT, false);
            setKey(KeyEvent.KEYCODE_DPAD_RIGHT, false);
            setKey(KeyEvent.KEYCODE_DPAD_UP, false);
            setKey(KeyEvent.KEYCODE_DPAD_DOWN, false);
            return;
        }
        float dx = stickCurX - stickOriginX;
        float dy = stickCurY - stickOriginY;
        float deadzone = stickRadius * 0.22f;

        setKey(KeyEvent.KEYCODE_DPAD_LEFT,  dx < -deadzone);
        setKey(KeyEvent.KEYCODE_DPAD_RIGHT, dx >  deadzone);
        setKey(KeyEvent.KEYCODE_DPAD_UP,    dy < -deadzone);
        setKey(KeyEvent.KEYCODE_DPAD_DOWN,  dy >  deadzone);
    }

    @Override
    public boolean onTouchEvent(MotionEvent event) {
        int action = event.getActionMasked();
        int idx = event.getActionIndex();
        int pid = event.getPointerId(idx);

        switch (action) {
            case MotionEvent.ACTION_DOWN:
            case MotionEvent.ACTION_POINTER_DOWN: {
                float x = event.getX(idx);
                float y = event.getY(idx);

                boolean handled = false;
                for (Button b : buttons) {
                    if (b.pointerId == -1 && b.hitTest(x, y)) {
                        b.pointerId = pid;
                        setKey(b.keyCode, true);
                        handled = true;
                        break;
                    }
                }
                if (!handled && stickPointerId == -1 && x < getWidth() * 0.55f) {
                    stickPointerId = pid;
                    stickOriginX = x;
                    stickOriginY = y;
                    stickCurX = x;
                    stickCurY = y;
                    updateStickKeys();
                }
                invalidate();
                return true;
            }

            case MotionEvent.ACTION_MOVE: {
                if (stickPointerId != -1) {
                    int sIdx = event.findPointerIndex(stickPointerId);
                    if (sIdx != -1) {
                        stickCurX = event.getX(sIdx);
                        stickCurY = event.getY(sIdx);
                        updateStickKeys();
                        invalidate();
                    }
                }
                return true;
            }

            case MotionEvent.ACTION_UP:
            case MotionEvent.ACTION_POINTER_UP:
            case MotionEvent.ACTION_CANCEL: {
                if (pid == stickPointerId || action == MotionEvent.ACTION_CANCEL) {
                    stickPointerId = -1;
                    updateStickKeys();
                }
                for (Button b : buttons) {
                    if (b.pointerId == pid || action == MotionEvent.ACTION_CANCEL) {
                        b.pointerId = -1;
                        setKey(b.keyCode, false);
                    }
                }
                invalidate();
                return true;
            }
        }
        return super.onTouchEvent(event);
    }
}
