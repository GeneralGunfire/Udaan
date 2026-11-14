//! Motion: springs that run on the compositor and then STOP.
//!
//! Presets come from the theme. Retargeting a running spring is free (the compositor
//! continues from the current value and velocity), which makes every animation
//! interruptible.
//!
//! Why the completion handling matters: a composition spring animation has no fixed
//! duration, so once started it keeps the compositor ticking indefinitely even after
//! the value has visibly settled. Measured on this PC, that alone cost about 4% of a
//! core at idle, against a target of ~0. Every spring is therefore started inside a
//! scoped batch, and when the batch completes we stop the animation, which hands the
//! property back to its static value and lets the compositor go quiet.

use crate::theme::Spring;
use windows::{
    core::{Interface, Result, HSTRING},
    Foundation::{IReference, PropertyValue, TimeSpan, TypedEventHandler},
    UI::Composition::{CompositionBatchCompletedEventArgs, CompositionBatchTypes, CompositionScopedBatch, Compositor, Visual},
};
use windows_numerics::Vector3;

/// Start `animation` on `prop` and stop it as soon as it settles, so the compositor
/// can idle at zero.
///
/// `final_value` is applied before the animation is stopped: stopping leaves the
/// property at whatever the animation last wrote, and committing the target first
/// guarantees the visual ends exactly where it was asked to go rather than a hair
/// short of it.
fn start_and_settle(
    c: &Compositor,
    v: &Visual,
    prop: &HSTRING,
    anim: &windows::UI::Composition::CompositionAnimation,
    final_value: f32,
) -> Result<()> {
    let batch: CompositionScopedBatch = c.CreateScopedBatch(CompositionBatchTypes::Animation)?;
    v.StartAnimation(prop, anim)?;
    let target = v.clone();
    let p = prop.clone();
    batch.Completed(&TypedEventHandler::<windows::core::IInspectable, CompositionBatchCompletedEventArgs>::new(
        move |_, _| {
            let _ = target.StopAnimation(&p);
            set_scalar(&target, &p.to_string(), final_value);
            Ok(())
        },
    ))?;
    batch.End()?;
    Ok(())
}

pub fn spring_to(c: &Compositor, v: &Visual, prop: &HSTRING, to: f32, s: Spring) {
    let go = || -> Result<()> {
        let sp = c.CreateSpringScalarAnimation()?;
        let fv = PropertyValue::CreateSingle(to)?.cast::<IReference<f32>>()?;
        sp.SetFinalValue(&fv)?;
        sp.SetDampingRatio(s.damping)?;
        sp.SetPeriod(TimeSpan { Duration: s.period_100ns() })?;
        start_and_settle(c, v, prop, &sp.cast()?, to)
    };
    let _ = go();
}

pub fn spring_v3(c: &Compositor, v: &Visual, prop: &HSTRING, to: Vector3, s: Spring) {
    let p = prop.to_string();
    spring_to(c, v, &HSTRING::from(format!("{p}.X")), to.X, s);
    spring_to(c, v, &HSTRING::from(format!("{p}.Y")), to.Y, s);
    if p != "Scale" {
        spring_to(c, v, &HSTRING::from(format!("{p}.Z")), to.Z, s);
    }
}

/// Uniform scale spring (X and Y together, Z untouched).
pub fn scale_to(c: &Compositor, v: &Visual, to: f32, s: Spring) {
    spring_v3(c, v, &HSTRING::from("Scale"), Vector3 { X: to, Y: to, Z: 1.0 }, s);
}

pub fn offset_to(c: &Compositor, v: &Visual, to: Vector3, s: Spring) {
    spring_v3(c, v, &HSTRING::from("Offset"), to, s);
}

pub fn opacity_to(c: &Compositor, v: &Visual, to: f32, s: Spring) {
    spring_to(c, v, &HSTRING::from("Opacity"), to, s);
}

pub fn rotation_to(c: &Compositor, v: &Visual, degrees: f32, s: Spring) {
    spring_to(c, v, &HSTRING::from("RotationAngleInDegrees"), degrees, s);
}

/// Write a single scalar sub-property ("Offset.X", "Opacity", ...) directly.
fn set_scalar(v: &Visual, prop: &str, value: f32) {
    let (base, comp) = match prop.split_once('.') {
        Some((b, c)) => (b, Some(c)),
        None => (prop, None),
    };
    match (base, comp) {
        ("Opacity", _) => {
            let _ = v.SetOpacity(value);
        }
        ("RotationAngleInDegrees", _) => {
            let _ = v.SetRotationAngleInDegrees(value);
        }
        ("Offset", Some(c)) => {
            if let Ok(mut o) = v.Offset() {
                match c {
                    "X" => o.X = value,
                    "Y" => o.Y = value,
                    _ => o.Z = value,
                }
                let _ = v.SetOffset(o);
            }
        }
        ("Scale", Some(c)) => {
            if let Ok(mut sc) = v.Scale() {
                match c {
                    "X" => sc.X = value,
                    "Y" => sc.Y = value,
                    _ => sc.Z = value,
                }
                let _ = v.SetScale(sc);
            }
        }
        _ => {}
    }
}

pub fn stop(v: &Visual, prop: &str) {
    let _ = v.StopAnimation(&HSTRING::from(prop));
}
