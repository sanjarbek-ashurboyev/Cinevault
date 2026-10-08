from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView


def health(request):
    """Liveness probe for the load balancer and `docker compose ps`.

    Deliberately does not touch the database or Redis: this answers "is
    gunicorn serving requests", and a check that fails on a slow query
    gets the whole site restarted for no reason.
    """
    return JsonResponse({'status': 'ok'})


urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/health/', health, name='health'),
    path('api/v1/', include('accounts.urls')),
    path('api/v1/', include('movies.urls')),
    path('api/v1/', include('halls.urls')),
    path('api/v1/', include('showtimes.urls')),
    path('api/v1/', include('reservations.urls')),
    path('api/v1/', include('payments.urls')),
    path('api/schema/', SpectacularAPIView.as_view(), name='schema'),
]

if settings.DEBUG or settings.EXPOSE_API_DOCS:
    urlpatterns += [
        path('api-auth/', include('rest_framework.urls')),
        path('swagger/', SpectacularSwaggerView.as_view(url_name='schema'), name='swagger-ui'),
    ]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
