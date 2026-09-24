Add-Type -AssemblyName System.Drawing
$iconDirectory = Join-Path (Split-Path -Parent $PSScriptRoot) 'public\icons'
New-Item -ItemType Directory -Path $iconDirectory -Force | Out-Null

foreach ($size in @(192, 512)) {
    $bitmap = [System.Drawing.Bitmap]::new($size, $size)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#08120f'))
    $graphics.ScaleTransform($size / 64, $size / 64)

    $shield = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $shield.AddLines([System.Drawing.PointF[]]@(
        [System.Drawing.PointF]::new(32, 10),
        [System.Drawing.PointF]::new(42, 14),
        [System.Drawing.PointF]::new(51, 17),
        [System.Drawing.PointF]::new(51, 32),
        [System.Drawing.PointF]::new(47, 44),
        [System.Drawing.PointF]::new(32, 56),
        [System.Drawing.PointF]::new(17, 44),
        [System.Drawing.PointF]::new(13, 32),
        [System.Drawing.PointF]::new(13, 17),
        [System.Drawing.PointF]::new(22, 14)
    ))
    $shield.CloseFigure()
    $lime = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#b7f34a'))
    $dark = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#08120f'))
    $graphics.FillPath($lime, $shield)

    $leaf = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $leaf.AddBezier(22, 35, 31, 34, 38, 25, 42, 18)
    $leaf.AddBezier(42, 18, 43, 32, 39, 39, 27, 42)
    $leaf.AddBezier(27, 42, 22, 43, 20, 39, 22, 35)
    $graphics.FillPath($dark, $leaf)

    $bitmap.Save((Join-Path $iconDirectory "icon-$size.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $leaf.Dispose()
    $shield.Dispose()
    $lime.Dispose()
    $dark.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
}
