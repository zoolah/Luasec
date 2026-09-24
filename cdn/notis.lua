if game.CoreGui:FindFirstChild("LuasecNotify") then
	game.CoreGui.LuasecNotify:Destroy();
end;
local TweenService = game:GetService("TweenService");
local gui = Instance.new("ScreenGui");
gui.Name = "LuasecNotify";
gui.Parent = game.CoreGui;
gui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling;
gui.ResetOnSpawn = false;
gui.IgnoreGuiInset = true;
local function tw(obj, dur, props, style, dir, del)
	local t = TweenService:Create(obj, TweenInfo.new(dur, style or Enum.EasingStyle.Quint, dir or Enum.EasingDirection.Out, 0, false, del or 0), props);
	t:Play();
	return t;
end;
local stack = Instance.new("Frame");
stack.Parent = gui;
stack.AnchorPoint = Vector2.new(1, 0);
stack.Position = UDim2.new(1, -16, 0, 16);
stack.BackgroundTransparency = 1;
stack.Size = UDim2.new(0, 320, 1, -32);
stack.BorderSizePixel = 0;
local stackLayout = Instance.new("UIListLayout");
stackLayout.Parent = stack;
stackLayout.SortOrder = Enum.SortOrder.LayoutOrder;
stackLayout.VerticalAlignment = Enum.VerticalAlignment.Top;
stackLayout.HorizontalAlignment = Enum.HorizontalAlignment.Right;
stackLayout.Padding = UDim.new(0, 8);
local template = Instance.new("Frame");
template.Name = "Notification";
template.BackgroundTransparency = 1;
template.Size = UDim2.new(1, 0, 0, 0);
template.AutomaticSize = Enum.AutomaticSize.Y;
template.BorderSizePixel = 0;
template.Visible = false;
template.ClipsDescendants = true;
local card = Instance.new("Frame");
card.Name = "Card";
card.Parent = template;
card.Size = UDim2.new(1, 0, 0, 0);
card.AutomaticSize = Enum.AutomaticSize.Y;
card.BackgroundColor3 = Color3.fromRGB(12, 12, 12);
card.BackgroundTransparency = 1;
card.BorderSizePixel = 0;
(Instance.new("UICorner", card)).CornerRadius = UDim.new(0, 8);
local stroke = Instance.new("UIStroke");
stroke.Name = "Stroke";
stroke.Color = Color3.fromRGB(255, 255, 255);
stroke.Transparency = 1;
stroke.Thickness = 1;
stroke.Parent = card;
local pad = Instance.new("UIPadding");
pad.PaddingTop = UDim.new(0, 14);
pad.PaddingBottom = UDim.new(0, 14);
pad.PaddingLeft = UDim.new(0, 16);
pad.PaddingRight = UDim.new(0, 16);
pad.Parent = card;
local layout = Instance.new("UIListLayout");
layout.Parent = card;
layout.SortOrder = Enum.SortOrder.LayoutOrder;
layout.Padding = UDim.new(0, 6);
local header = Instance.new("Frame");
header.Name = "Header";
header.Parent = card;
header.BackgroundTransparency = 1;
header.Size = UDim2.new(1, 0, 0, 0);
header.AutomaticSize = Enum.AutomaticSize.Y;
header.LayoutOrder = 0;
local headerLayout = Instance.new("UIListLayout");
headerLayout.Parent = header;
headerLayout.FillDirection = Enum.FillDirection.Horizontal;
headerLayout.SortOrder = Enum.SortOrder.LayoutOrder;
headerLayout.VerticalAlignment = Enum.VerticalAlignment.Center;
headerLayout.Padding = UDim.new(0, 6);
local brandLabel = Instance.new("TextLabel");
brandLabel.Name = "Brand";
brandLabel.Parent = header;
brandLabel.BackgroundColor3 = Color3.fromRGB(255, 255, 255);
brandLabel.BackgroundTransparency = 1;
brandLabel.Size = UDim2.new(0, 0, 0, 0);
brandLabel.AutomaticSize = Enum.AutomaticSize.XY;
brandLabel.Font = Enum.Font.GothamBold;
brandLabel.TextColor3 = Color3.fromRGB(255, 255, 255);
brandLabel.TextTransparency = 1;
brandLabel.TextSize = 9;
brandLabel.Text = "LUASEC";
brandLabel.LayoutOrder = 0;
local brandPad = Instance.new("UIPadding");
brandPad.PaddingTop = UDim.new(0, 2);
brandPad.PaddingBottom = UDim.new(0, 2);
brandPad.PaddingLeft = UDim.new(0, 5);
brandPad.PaddingRight = UDim.new(0, 5);
brandPad.Parent = brandLabel;
local brandCorner = Instance.new("UICorner");
brandCorner.CornerRadius = UDim.new(0, 4);
brandCorner.Parent = brandLabel;
local brandStroke = Instance.new("UIStroke");
brandStroke.Color = Color3.fromRGB(255, 255, 255);
brandStroke.Transparency = 1;
brandStroke.Thickness = 1;
brandStroke.Parent = brandLabel;
local titleLabel = Instance.new("TextLabel");
titleLabel.Name = "Title";
titleLabel.Parent = header;
titleLabel.BackgroundTransparency = 1;
titleLabel.Size = UDim2.new(0, 0, 0, 0);
titleLabel.AutomaticSize = Enum.AutomaticSize.XY;
titleLabel.Font = Enum.Font.GothamBold;
titleLabel.TextColor3 = Color3.fromRGB(255, 255, 255);
titleLabel.TextTransparency = 1;
titleLabel.TextSize = 13;
titleLabel.LayoutOrder = 1;
local sep = Instance.new("Frame");
sep.Name = "Sep";
sep.Parent = card;
sep.BackgroundColor3 = Color3.fromRGB(255, 255, 255);
sep.BackgroundTransparency = 1;
sep.Size = UDim2.new(1, 0, 0, 1);
sep.BorderSizePixel = 0;
sep.LayoutOrder = 1;
local contentLabel = Instance.new("TextLabel");
contentLabel.Name = "Content";
contentLabel.Parent = card;
contentLabel.BackgroundTransparency = 1;
contentLabel.Size = UDim2.new(1, 0, 0, 0);
contentLabel.AutomaticSize = Enum.AutomaticSize.Y;
contentLabel.Font = Enum.Font.Gotham;
contentLabel.TextColor3 = Color3.fromRGB(200, 200, 200);
contentLabel.TextTransparency = 1;
contentLabel.TextSize = 12;
contentLabel.TextWrapped = true;
contentLabel.RichText = true;
contentLabel.TextXAlignment = Enum.TextXAlignment.Left;
contentLabel.TextYAlignment = Enum.TextYAlignment.Top;
contentLabel.LayoutOrder = 2;
local progress = Instance.new("Frame");
progress.Name = "Progress";
progress.Parent = card;
progress.BackgroundColor3 = Color3.fromRGB(255, 255, 255);
progress.BackgroundTransparency = 1;
progress.Size = UDim2.new(1, 0, 0, 2);
progress.BorderSizePixel = 0;
progress.LayoutOrder = 3;
(Instance.new("UICorner", progress)).CornerRadius = UDim.new(0, 1);
local orderCounter = 0;
local function prompt(titleText, bodyText, closeTime)
	orderCounter = orderCounter + 1;
	local notif = template:Clone();
	notif.LayoutOrder = orderCounter;
	notif.Visible = true;
	notif.Parent = stack;
	local c = notif.Card;
	local prog = c.Progress;
	local sepLine = c.Sep;
	c.Header.Title.Text = titleText;
	c.Content.Text = bodyText;
	local snd = Instance.new("Sound");
	snd.SoundId = "rbxassetid://6518811702";
	snd.Volume = 0.4;
	snd.Parent = gui;
	snd:Play();
	task.delay(2, function()
		snd:Destroy();
	end);
	task.wait();
	c.BackgroundTransparency = 0.06;
	tw(c.Stroke, 0.3, {
		Transparency = 0.92
	}, Enum.EasingStyle.Sine);
	task.delay(0.05, function()
		if not c.Parent then
			return;
		end;
		tw(c.Header.Brand, 0.25, {
			TextTransparency = 0.3,
			BackgroundTransparency = 0.92
		}, Enum.EasingStyle.Sine);
		tw(brandStroke, 0.25, {
			Transparency = 0.85
		}, Enum.EasingStyle.Sine);
	end);
	task.delay(0.08, function()
		if not c.Parent then
			return;
		end;
		tw(c.Header.Title, 0.25, {
			TextTransparency = 0
		}, Enum.EasingStyle.Sine);
	end);
	task.delay(0.12, function()
		if not sepLine.Parent then
			return;
		end;
		tw(sepLine, 0.3, {
			BackgroundTransparency = 0.92
		}, Enum.EasingStyle.Sine);
	end);
	task.delay(0.15, function()
		if not c.Parent then
			return;
		end;
		tw(c.Content, 0.3, {
			TextTransparency = 0.15
		}, Enum.EasingStyle.Sine);
	end);
	if typeof(closeTime) == "number" and closeTime > 0 then
		task.delay(0.3, function()
			if not prog.Parent then
				return;
			end;
			tw(prog, 0.15, {
				BackgroundTransparency = 0.7
			}, Enum.EasingStyle.Sine);
			task.delay(0.15, function()
				if not prog.Parent then
					return;
				end;
				(TweenService:Create(prog, TweenInfo.new(closeTime - 0.45, Enum.EasingStyle.Linear), {
					Size = UDim2.new(0, 0, 0, 2)
				})):Play();
			end);
		end);
	end;
	local dismissed = false;
	local function dismiss()
		if dismissed then
			return;
		end;
		dismissed = true;
		tw(c.Header.Brand, 0.15, {
			TextTransparency = 1,
			BackgroundTransparency = 1
		});
		tw(c.Header.Title, 0.15, {
			TextTransparency = 1
		});
		tw(c.Content, 0.15, {
			TextTransparency = 1
		});
		tw(sepLine, 0.12, {
			BackgroundTransparency = 1
		});
		tw(prog, 0.1, {
			BackgroundTransparency = 1
		});
		tw(c.Stroke, 0.15, {
			Transparency = 1
		});
		tw(c, 0.25, {
			BackgroundTransparency = 1
		}, Enum.EasingStyle.Sine);
		task.delay(0.1, function()
			tw(notif, 0.3, {
				Size = UDim2.new(1, 0, 0, 0)
			}, Enum.EasingStyle.Quint, Enum.EasingDirection.In);
		end);
		task.wait(0.4);
		notif:Destroy();
	end;
	if typeof(closeTime) == "number" then
		task.delay(closeTime, dismiss);
	end;
end;
local lib = {};
function lib.prompt(title, description, closeTime)
	prompt(title, description, closeTime);
end;
return lib;
