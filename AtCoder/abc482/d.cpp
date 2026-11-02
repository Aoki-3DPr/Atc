#include <bits/stdc++.h>
#define ll long long
using namespace std;

// https://github.com/Aoki-3DPr/Atc

ll di[8] = {1, 0, -1, 0, 1, 1, -1, -1};
ll dj[8] = {0, 1, 0, -1, 1, -1, 1, -1};

ll solve() {
	ll n; cin >> n;
	vector<ll> a(n);
	for (ll i = 0; i < n; i++) cin >> a[i];
	cout << (a[n - 1] - a[0]) / 2 << endl;
	for (ll i = 1; i < n - 1; i++) {
		ll ans = min(max(a[i - 1] - a[0], a[n - 1] - a[i]) + a[i] - a[i - 1], max(a[i] - a[0] , a[n - 1] - a[i + 1]) + a[i + 1] - a[i]);
		cout << ans / 2 << endl;
	}
	if (n == 1) return 0;
	cout << (a[n - 1] - a[0]) / 2 << endl;
	return 0;
}

int main() {
	solve();
    return 0;
}

