from django import forms
from django.contrib.auth import get_user_model
from django.contrib.auth.forms import UserChangeForm, UserCreationForm

User = get_user_model()


class CustomUserChangeForm(UserChangeForm):
    display_name = forms.CharField(max_length=150, required=False)

    class Meta(UserChangeForm.Meta):
        model = User
        fields = '__all__'

    def save(self, commit=True):
        user = super().save(commit=False)
        user.display_name = self.cleaned_data.get('display_name', '') or ''
        if commit:
            user.save()
        return user


class CustomUserCreationForm(UserCreationForm):
    display_name = forms.CharField(max_length=150, required=False)

    class Meta(UserCreationForm.Meta):
        model = User
        fields = ("username", "password1", "password2", "email", "first_name", "last_name", "display_name")
