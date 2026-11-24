#include <bits/stdc++.h>
#define ll long long
using namespace std;

// https://github.com/Aoki-3DPr/Atc

ll di[8] = {1, 0, -1, 0, 1, 1, -1, -1};
ll dj[8] = {0, 1, 0, -1, 1, -1, 1, -1};

ll solve() {
	ll n;
	cin >> n;
	string s;
	cin >> s;
	ll l = -1, r = -2;
	ll buf = 0;
	for (ll i = 0; i < n; i++) {
		buf |= 1 << (s[i] - 'A');
		if (buf == 7) {
			l = i + 1;
			break;
		}
	}
	buf = 0;
	for (ll i = n - 1; i >= 0; i--) {
		buf |= 1 << (s[i] - 'A');
		if (buf == 7) {
			r = i;
			break;
		}
	}
	if (l >= r) {
		cout << 0;
		return 0;
	}
	ll j = l;
	ll a = 0, b = 0, c = 0;
	ll ans = 0;
	for (ll i = l; i < r - 2; i++) {
		if (i != l) {
			if (s[i - 1] == 'A') {
				a--;
			} else if (s[i - 1] == 'B') {
				b--;
			} else if (s[i - 1] == 'C') {
				c--;
			}
		}
		while ((a < 1 || b < 1 || c < 1) && j < r) {
			if (s[j] == 'A') {
				a++;
			} else if (s[j] == 'B') {
				b++;
			} else if (s[j] == 'C') {
				c++;
			}
			j++;
		}
		if (a >= 1 && b >= 1 && c >= 1) {
			ans += r - j + 1;
		}

	}
	cout << ans;
	return 0;
}

int main() {
	solve();
	return 0;
}
