import React, { useRef, useEffect, useCallback, useMemo } from 'react'
import { gsap } from 'gsap'
import { InertiaPlugin } from 'gsap/InertiaPlugin'
import './DotGrid.css'

const throttle = (func, limit) => {
  let lastCall = 0
  return function (...args) {
    const now = performance.now()
    if (now - lastCall >= limit) {
      lastCall = now
      func.apply(this, args)
    }
  }
}

function hexToRgb(hex) {
  if (!hex) return { r: 0, g: 0, b: 0 }
  let h = hex.trim().replace('#', '')
  // Handle 8-digit hex (#RRGGBBAA) by discarding alpha
  if (h.length === 8) h = h.slice(0, 6)
  // Handle 3-digit hex (#RGB)
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  if (h.length !== 6) return { r: 0, g: 0, b: 0 }
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return { r: 0, g: 0, b: 0 }
  return { r, g, b }
}

const DotGrid = ({
  dotSize = 16,
  gap = 32,
  baseColor = '#5227FF',
  activeColor = '#5227FF',
  proximity = 150,
  speedTrigger = 100,
  shockRadius = 250,
  shockStrength = 5,
  maxSpeed = 5000,
  resistance = 750,
  returnDuration = 1.5,
  alpha = 0.35,
  className = '',
  style,
}) => {
  const wrapperRef = useRef(null)
  const canvasRef = useRef(null)
  const dotsRef = useRef([])
  const sizeRef = useRef({ width: 0, height: 0 })
  const pointerRef = useRef({
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    speed: 0,
    lastTime: 0,
    lastX: 0,
    lastY: 0,
  })

  const baseRgb = useMemo(() => hexToRgb(baseColor), [baseColor])
  const activeRgb = useMemo(() => hexToRgb(activeColor), [activeColor])

  const circlePath = useMemo(() => {
    if (typeof window === 'undefined' || !window.Path2D) return null
    const p = new window.Path2D()
    p.arc(0, 0, dotSize / 2, 0, Math.PI * 2)
    return p
  }, [dotSize])

  const buildGrid = useCallback(() => {
    const wrap = wrapperRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return

  const { width, height } = wrap.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1

    canvas.width = width * dpr
    canvas.height = height * dpr
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
  const ctx = canvas.getContext('2d')
  if (ctx) ctx.scale(dpr, dpr)

  sizeRef.current = { width, height }

    const cols = Math.floor((width + gap) / (dotSize + gap))
    const rows = Math.floor((height + gap) / (dotSize + gap))
    const cell = dotSize + gap

    const gridW = cell * cols - gap
    const gridH = cell * rows - gap

    const extraX = width - gridW
    const extraY = height - gridH

    const startX = extraX / 2 + dotSize / 2
    const startY = extraY / 2 + dotSize / 2

    const dots = []
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const cx = startX + x * cell
        const cy = startY + y * cell
        dots.push({ cx, cy, xOffset: 0, yOffset: 0, _inertiaApplied: false })
      }
    }
    dotsRef.current = dots
  }, [dotSize, gap])

  useEffect(() => {
    if (!circlePath) return

    let rafId
    const proxSq = proximity * proximity

    const draw = () => {
  const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
  // Clear using CSS pixel size because context is scaled by dpr
  const { width, height } = sizeRef.current
  ctx.clearRect(0, 0, width, height)

      const { x: px, y: py } = pointerRef.current

      for (const dot of dotsRef.current) {
        const ox = dot.cx + dot.xOffset
        const oy = dot.cy + dot.yOffset
        const dx = dot.cx - px
        const dy = dot.cy - py
        const dsq = dx * dx + dy * dy

        let styleFill = baseColor
        if (dsq <= proxSq) {
          const dist = Math.sqrt(dsq)
          const t = 1 - dist / proximity
          const r = Math.round(baseRgb.r + (activeRgb.r - baseRgb.r) * t)
          const g = Math.round(baseRgb.g + (activeRgb.g - baseRgb.g) * t)
          const b = Math.round(baseRgb.b + (activeRgb.b - baseRgb.b) * t)
          styleFill = `rgb(${r},${g},${b})`
        }

        ctx.save()
        ctx.translate(ox, oy)
        ctx.globalAlpha = alpha
        ctx.fillStyle = styleFill
        if (circlePath) {
          ctx.fill(circlePath)
        } else {
          ctx.beginPath()
          ctx.arc(0, 0, dotSize / 2, 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.restore()
      }

      rafId = requestAnimationFrame(draw)
    }

    draw()
    return () => cancelAnimationFrame(rafId)
  }, [proximity, baseColor, activeRgb, baseRgb, circlePath])

  useEffect(() => {
    buildGrid()
    let ro = null
    if ('ResizeObserver' in window) {
      ro = new ResizeObserver(buildGrid)
      wrapperRef.current && ro.observe(wrapperRef.current)
    } else {
      window.addEventListener('resize', buildGrid)
    }
    return () => {
      if (ro) ro.disconnect()
      else window.removeEventListener('resize', buildGrid)
    }
  }, [buildGrid])

  useEffect(() => {
    // Ensure inertia physics behaves as expected
    if (InertiaPlugin) {
      gsap.registerPlugin(InertiaPlugin)
    }

    const onMove = (e) => {
      const now = performance.now()
      const pr = pointerRef.current
      const dt = pr.lastTime ? now - pr.lastTime : 16
      const dx = e.clientX - pr.lastX
      const dy = e.clientY - pr.lastY
      let vx = (dx / dt) * 1000
      let vy = (dy / dt) * 1000
      let speed = Math.hypot(vx, vy)
      if (speed > maxSpeed) {
        const scale = maxSpeed / speed
        vx *= scale
        vy *= scale
        speed = maxSpeed
      }
      pr.lastTime = now
      pr.lastX = e.clientX
      pr.lastY = e.clientY
      pr.vx = vx
      pr.vy = vy
      pr.speed = speed

      const rect = canvasRef.current.getBoundingClientRect()
      pr.x = e.clientX - rect.left
      pr.y = e.clientY - rect.top

      for (const dot of dotsRef.current) {
        const dist = Math.hypot(dot.cx - pr.x, dot.cy - pr.y)
        if (speed > speedTrigger && dist < proximity && !dot._inertiaApplied) {
          dot._inertiaApplied = true
          gsap.killTweensOf(dot)
          const pushX = dot.cx - pr.x + vx * 0.005
          const pushY = dot.cy - pr.y + vy * 0.005

          gsap.to(dot, {
            inertia: { xOffset: pushX, yOffset: pushY, resistance },
            onComplete: () => {
              gsap.to(dot, {
                xOffset: 0,
                yOffset: 0,
                duration: returnDuration,
                ease: 'elastic.out(1,0.75)',
                onComplete: () => { dot._inertiaApplied = false },
              })
            },
          })
        }
      }
    }

    const onClick = (e) => {
      const rect = canvasRef.current.getBoundingClientRect()
      const cx = e.clientX - rect.left
      const cy = e.clientY - rect.top
      for (const dot of dotsRef.current) {
        const dist = Math.hypot(dot.cx - cx, dot.cy - cy)
        if (dist < shockRadius && !dot._inertiaApplied) {
          dot._inertiaApplied = true
          gsap.killTweensOf(dot)
          const falloff = Math.max(0, 1 - dist / shockRadius)
          const pushX = (dot.cx - cx) * shockStrength * falloff
          const pushY = (dot.cy - cy) * shockStrength * falloff
          gsap.to(dot, {
            inertia: { xOffset: pushX, yOffset: pushY, resistance },
            onComplete: () => {
              gsap.to(dot, {
                xOffset: 0,
                yOffset: 0,
                duration: returnDuration,
                ease: 'elastic.out(1,0.75)',
                onComplete: () => { dot._inertiaApplied = false },
              })
            },
          })
        }
      }
    }

    const throttledMove = throttle(onMove, 50)
    window.addEventListener('mousemove', throttledMove, { passive: true })
    window.addEventListener('click', onClick)

    return () => {
      window.removeEventListener('mousemove', throttledMove)
      window.removeEventListener('click', onClick)
    }
  }, [maxSpeed, speedTrigger, proximity, resistance, returnDuration, shockRadius, shockStrength])

  return (
    <section className={`dot-grid ${className}`} style={style}>
      <div ref={wrapperRef} className="dot-grid__wrap">
        <canvas ref={canvasRef} className="dot-grid__canvas" />
      </div>
    </section>
  )
}

export default DotGrid
